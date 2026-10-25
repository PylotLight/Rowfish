import { parentPort } from "node:worker_threads";
import type { DatabaseQueryRequest } from "../shared/database";
import {
  config,
  state,
  post,
  connectError,
  safeError,
  type WorkerRequest,
} from "./worker/shared";
import {
  openConnection,
  probeConnection,
  readPostgres,
} from "./worker/postgres";
import { mutateMongo, readMongo } from "./worker/mongo";
import { inspect } from "./worker/inspect";

async function run(request: DatabaseQueryRequest): Promise<void> {
  try {
    if (config.kind === "postgres") await readPostgres(request);
    else await readMongo(request);
  } catch (error) {
    post({
      type: "error",
      queryId: request.queryId,
      message: safeError(error),
    });
  }
}

parentPort?.on("message", (message: WorkerRequest) => {
  if (message.type === "close") {
    state.closing = true;
    void (async () => {
      try {
        if (state.postgres) await state.postgres.end();
        if (state.mongo) await state.mongo.close();
      } finally {
        post({ type: "closed" });
        parentPort?.close();
      }
    })();
    return;
  }
  if (
    message.type === "inspect-databases" ||
    message.type === "inspect-tables" ||
    message.type === "inspect-mongo-databases" ||
    message.type === "inspect-mongo-collections" ||
    message.type === "inspect-mongo-collection" ||
    message.type === "inspect-postgres-table" ||
    message.type === "inspect-postgres-server" ||
    message.type === "inspect-postgres-columns" ||
    message.type === "get-postgres-row" ||
    message.type === "update-postgres-row"
  ) {
    void inspect(message);
    return;
  }
  if (message.type === "mongo-operation") {
    void mutateMongo(message.requestId, message.request);
    return;
  }
  if (message.type === "run") void run(message.request);
});

if (config.probe) void probeConnection();
else
  void openConnection().catch((error: unknown) => {
    post({ type: "connect-error", message: connectError(error) });
  });
