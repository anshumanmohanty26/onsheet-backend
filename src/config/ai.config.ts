import { registerAs } from "@nestjs/config";

/**
 * AI / LLM configuration.
 *
 * Authentication (choose one):
 *  - **API key** (recommended for development):
 *    Set `GOOGLE_VERTEX_AI_API_KEY` to a GCP API key that has the Vertex AI API enabled.
 *  - **Service account** (recommended for production):
 *    Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of your service-account JSON file,
 *    or set `GOOGLE_VERTEX_AI_WEB_CREDENTIALS` to the JSON string of the credentials.
 */
export default registerAs("ai", () => ({
	/**
	 * Vertex AI Gemini model identifier.
	 * @see https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models
	 */
	model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",

	/** GCP project ID. Required when using API key or service account auth. */
	project: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT,

	/** GCP region where the Vertex AI endpoint lives. */
	location: process.env.GOOGLE_VERTEX_AI_LOCATION ?? "us-central1",

	/** API key for Vertex AI (Express Mode). Takes precedence over ADC when set. */
	apiKey: process.env.GOOGLE_VERTEX_AI_API_KEY,
}));
