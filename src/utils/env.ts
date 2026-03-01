import dotenv from "dotenv";
import z from "zod";

dotenv.config();
export const envVars = z
	.object({
		AI_API_KEY: z.string(),
		MODEL_NAME: z.string(),
		ACCOUNT_EMAIL: z.string().email().optional(),
		ACCOUNT_PASSWORD: z.string().optional(),
	})
	.parse(process.env);
