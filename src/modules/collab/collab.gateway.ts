import { randomUUID } from 'node:crypto';
import { ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ACCESS_COOKIE } from '../../config/cookie.config';
import { CellsService } from '../cells/cells.service';
import { UpdateCellDto } from '../cells/dto/update-cell.dto';
import { UsersService } from '../users/users.service';
import { CollabService } from './collab.service';
import { OperationLogService } from './operation-log.service';

/** Parse a raw Cookie header string into a key→value map. */
function parseCookies(header = ''): Record<string, string> {
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k]) => Boolean(k))
      .map(([k, ...v]) => [k.trim(), v.join('=').trim()]),
  );
}

/** Milliseconds to accumulate writes per sheet before flushing to the DB. */
const BATCH_WINDOW_MS = 50;

/** A single cell write that is queued in the batch buffer. */
interface PendingWrite {
  sheetId: string;
  userId: string;
  dto: UpdateCellDto;
  clientSocket: Socket;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/collab' })
export class CollabGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(CollabGateway.name);

  // socketId → { sheetId, userId, displayName }
  private readonly socketMeta = new Map<
    string,
    { sheetId: string; userId: string; displayName: string }
  >();

  // Write-batch buffer keyed by sheetId
  private readonly pendingBatches = new Map<string, PendingWrite[]>();
  private readonly batchTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly collabService: CollabService,
    private readonly cellsService: CellsService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly opLog: OperationLogService,
  ) {}

  async handleConnection(client: Socket) {
    const handshakeToken = client.handshake.auth?.token as string | undefined;
    const cookies = parseCookies(client.handshake.headers.cookie as string | undefined);
    const token = handshakeToken ?? cookies[ACCESS_COOKIE];

    if (token) {
      try {
        const payload = await this.jwtService.verifyAsync<{ sub: string; email: string }>(token, {
          secret: this.config.get<string>('jwt.accessSecret'),
        });
        const user = await this.usersService.findById(payload.sub);
        if (!user) {
          client.disconnect();
          return;
        }
        const { passwordHash: _ph, refreshToken: _rt, ...safe } = user;
        client.data.user = safe;
        client.data.isGuest = false;
      } catch {
        client.data.isGuest = true;
        client.data.guestId = `guest_${randomUUID().slice(0, 8)}`;
      }
    } else {
      client.data.isGuest = true;
      client.data.guestId = `guest_${randomUUID().slice(0, 8)}`;
    }

    this.logger.log(
      `Connected: ${client.id} (${client.data.isGuest ? (client.data.guestId as string) : (client.data.user?.email as string)})`,
    );
  }

  handleDisconnect(client: Socket) {
    const meta = this.socketMeta.get(client.id);
    if (meta) {
      this.collabService.leave(meta.sheetId, client.id);
      client.to(meta.sheetId).emit('user:left', { socketId: client.id });
      this.socketMeta.delete(client.id);
    }
    this.logger.log(`Disconnected: ${client.id}`);
  }

  @SubscribeMessage('sheet:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sheetId: string; displayName?: string; sinceVersion?: number },
  ) {
    const userId: string = client.data.isGuest
      ? (client.data.guestId as string)
      : (client.data.user?.id as string);
    const displayName: string = client.data.isGuest
      ? (payload.displayName ?? 'Guest')
      : (((client.data.user?.displayName ?? client.data.user?.email) as string) ?? 'User');

    client.join(payload.sheetId);
    const users = this.collabService.join(payload.sheetId, {
      userId,
      displayName,
      socketId: client.id,
    });
    this.socketMeta.set(client.id, { sheetId: payload.sheetId, userId, displayName });
    client.to(payload.sheetId).emit('user:joined', users);
    client.emit('sheet:users', users);

    // Send recent operations so late-joiners can catch up
    const recentOps = await this.opLog.getRecent(payload.sheetId, 200);
    if (recentOps.length > 0) {
      client.emit('ops:catchup', recentOps.reverse());
    }
  }

  @SubscribeMessage('cursor:move')
  handleCursor(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { row: number; col: number },
  ) {
    const meta = this.socketMeta.get(client.id);
    if (!meta) return;
    this.collabService.updateCursor(meta.sheetId, client.id, payload);
    client.to(meta.sheetId).emit('cursor:moved', { socketId: client.id, ...payload });
  }

  @SubscribeMessage('cell:update')
  async handleCellUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sheetId: string; cell: UpdateCellDto },
  ) {
    if (client.data.isGuest) {
      client.emit('collab:error', { message: 'Guests cannot edit cells' });
      return;
    }

    const meta = this.socketMeta.get(client.id);
    if (!meta) return;
    const userId = client.data.user.id as string;

    // Queue the write into the batch buffer
    return new Promise((resolve, reject) => {
      this.enqueueWrite({
        sheetId: payload.sheetId,
        userId,
        dto: payload.cell,
        clientSocket: client,
        resolve,
        reject,
      });
    });
  }

  /** Request cell history for a specific cell (undo/audit). */
  @SubscribeMessage('cell:history')
  async handleCellHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sheetId: string; row: number; col: number; limit?: number },
  ) {
    const history = await this.opLog.getCellHistory(
      payload.sheetId,
      payload.row,
      payload.col,
      payload.limit ?? 50,
    );
    client.emit('cell:history', history);
  }

  /**
   * Adds a write to the per-sheet batch buffer and resets the flush timer.
   * The same cell written multiple times within {@link BATCH_WINDOW_MS} is
   * deduplicated so only the last value reaches the database.
   */
  private enqueueWrite(write: PendingWrite) {
    const key = write.sheetId;
    if (!this.pendingBatches.has(key)) {
      this.pendingBatches.set(key, []);
    }
    this.pendingBatches.get(key)?.push(write);

    // Reset the flush timer for this sheet
    if (this.batchTimers.has(key)) {
      clearTimeout(this.batchTimers.get(key));
    }
    this.batchTimers.set(
      key,
      setTimeout(() => this.flushBatch(key), BATCH_WINDOW_MS),
    );
  }

  private async flushBatch(sheetId: string) {
    const writes = this.pendingBatches.get(sheetId);
    this.pendingBatches.delete(sheetId);
    this.batchTimers.delete(sheetId);
    if (!writes || writes.length === 0) return;

    // Deduplicate: if multiple writes to the same cell in the same batch,
    // keep only the latest one (last-writer-wins within the batch window).
    const cellKey = (w: PendingWrite) => `${w.dto.row}:${w.dto.col}`;
    const deduped = new Map<string, PendingWrite>();
    for (const w of writes) {
      deduped.set(cellKey(w), w);
    }

    for (const write of deduped.values()) {
      try {
        const cell = await this.cellsService.upsert(write.sheetId, write.userId, write.dto, 'ws');

        // Broadcast the authoritative saved cell to all other clients in the room.
        // Use server.to(room).except(socketId) so the broadcast is routed through
        // the server (always alive) rather than the client socket (may disconnect
        // during the 50 ms batch window).  Include `computed` from the DB result
        // so formula cells show the evaluated value on peers rather than raw formula text.
        this.server.to(write.sheetId).except(write.clientSocket.id).emit('cell:updated', {
          userId: write.userId,
          cell: {
            row: cell.row,
            col: cell.col,
            rawValue: cell.rawValue,
            computed: cell.computed,
            style: write.dto.style,
            version: cell.version,
          },
        });

        // Confirm to the sender with the server-assigned version
        write.clientSocket.emit('cell:confirmed', {
          row: write.dto.row,
          col: write.dto.col,
          version: cell.version,
        });

        write.resolve(cell);
      } catch (err) {
        if (err instanceof ConflictException) {
          // Send the server state so the client can re-merge
          write.clientSocket.emit('cell:conflict', {
            row: write.dto.row,
            col: write.dto.col,
            serverCell: (err.getResponse() as Record<string, unknown>).serverCell,
          });
        } else {
          write.clientSocket.emit('collab:error', {
            message: err instanceof Error ? err.message : 'Write failed',
          });
        }
        write.reject(err);
      }
    }
  }
}
