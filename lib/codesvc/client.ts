import fs from "node:fs";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

function resolveRepoRoot(): string {
  const up = path.resolve(process.cwd(), "..");
  if (fs.existsSync(path.join(up, "proto/codesvc/v1/codesvc.proto"))) return up;
  if (fs.existsSync(path.join(process.cwd(), "proto/codesvc/v1/codesvc.proto")))
    return process.cwd();
  return up;
}

export const REPO_ROOT = resolveRepoRoot();

const PROTO_PATH = path.join(REPO_ROOT, "proto/codesvc/v1/codesvc.proto");

let cached: ReturnType<typeof protoLoader.loadSync> | null = null;

function loadPackageDefinition() {
  if (cached) return cached;
  if (!fs.existsSync(PROTO_PATH)) {
    throw new Error(`Proto not found: ${PROTO_PATH} (cwd=${process.cwd()})`);
  }
  cached = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [path.join(REPO_ROOT, "proto")],
  });
  return cached;
}

export function getGrpcAddress(): string {
  return process.env.CODESVC_GRPC_ADDR?.trim() || "127.0.0.1:8081";
}

export function getCodeServiceConstructor(): grpc.ServiceClientConstructor {
  const def = loadPackageDefinition();
  const root = grpc.loadPackageDefinition(def) as Record<string, unknown>;
  const codesvc = root.codesvc as Record<string, unknown> | undefined;
  const v1 = codesvc?.v1 as Record<string, unknown> | undefined;
  const Ctor = v1?.CodeService as grpc.ServiceClientConstructor | undefined;
  if (!Ctor) throw new Error("codesvc.v1.CodeService not found in proto load");
  return Ctor;
}

export function createCodeServiceClient(): grpc.Client {
  const Ctor = getCodeServiceConstructor();
  const addr = getGrpcAddress();
  return new Ctor(addr, grpc.credentials.createInsecure()) as grpc.Client;
}

export function promisifyUnary<TReq, TRes>(
  client: grpc.Client,
  method: string,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    const fn = (client as unknown as Record<string, unknown>)[method] as
      | ((req: TReq, cb: grpc.requestCallback<TRes>) => void)
      | undefined;
    if (typeof fn !== "function") {
      reject(new Error(`gRPC method not found: ${method}`));
      return;
    }
    fn.call(client, request, (err: grpc.ServiceError | null, res?: TRes) => {
      if (err) reject(err);
      else resolve(res as TRes);
    });
  });
}
