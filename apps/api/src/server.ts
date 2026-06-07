import "dotenv/config";
import { buildApp } from "./app.js";

const app = await buildApp();

const port = Number(process.env.API_PORT || 8000);

await app.listen({
  host: "0.0.0.0",
  port,
});
