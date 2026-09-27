// The autofill worker: fills employers' public application forms with
// Playwright so the applicant can review them before sending.
//
//   GET  /health        liveness
//   POST /ats/discover  { job_url }                      -> the form's fields
//   POST /ats/prepare   { job_url, candidate, planned? } -> filled, screenshotted, not sent
//
// Deployed to Cloud Run with IAM-only ingress, and every call must also carry
// the shared secret in x-ats-token. A browser that opens any URL it is handed
// must never be reachable by the public.
//
// It never submits unless the request says submit: true AND the deployment
// sets ATS_ALLOW_SUBMIT=true. Leave that unset and nothing is ever sent.

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { discover, fill } from "./form-filler.mjs";

const PORT = Number(process.env.PORT ?? process.env.ATS_WORKER_PORT ?? 8789);
const TOKEN = process.env.ATS_WORKER_TOKEN ?? "";
const ALLOW_SUBMIT = process.env.ATS_ALLOW_SUBMIT === "true";

function authorized(request) {
  if (!TOKEN) return false;
  const supplied = Buffer.from(String(request.headers["x-ats-token"] ?? ""));
  const expected = Buffer.from(TOKEN);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512_000) throw new Error("payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, { status: "ok", service: "ats-worker", submit: ALLOW_SUBMIT ? "enabled" : "review-only" });
  }

  const isDiscover = request.method === "POST" && request.url === "/ats/discover";
  const isPrepare = request.method === "POST" && request.url === "/ats/prepare";
  if (!isDiscover && !isPrepare) return json(response, 404, { error: "not found" });
  if (!authorized(request)) return json(response, 401, { error: "unauthorized" });

  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    return json(response, 400, { error: error.message });
  }

  if (isDiscover) {
    if (!body.job_url) return json(response, 400, { error: "job_url is required" });
    try {
      const found = await discover({ jobUrl: body.job_url });
      console.log(JSON.stringify({ event: "ats_fields_discovered", job_url: body.job_url, field_count: found.fields.length }));
      return json(response, 200, found);
    } catch (error) {
      return json(response, 502, { error: `could not read the form: ${error.message}` });
    }
  }

  if (!body.job_url || !body.candidate) {
    return json(response, 400, { error: "job_url and candidate are required" });
  }
  try {
    const record = await fill({
      jobUrl: body.job_url,
      candidate: body.candidate,
      planned: Array.isArray(body.planned) ? body.planned : [],
      submit: body.submit === true && ALLOW_SUBMIT,
    });
    if (body.submit === true && !ALLOW_SUBMIT) {
      record.spoken_reason = "The form was prepared but not submitted: this worker runs in review-only mode.";
    }
    return json(response, 200, record);
  } catch (error) {
    console.log(JSON.stringify({ event: "ats_apply_failed", job_url: body.job_url, error: error.message }));
    return json(response, 502, { error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ats-worker listening on ${PORT} (${ALLOW_SUBMIT ? "submit enabled" : "review-only"})`);
  if (!TOKEN) console.warn("ATS_WORKER_TOKEN is unset; every request will be rejected.");
});
