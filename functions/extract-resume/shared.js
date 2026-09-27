/**
 * Pieces every function in the profile pipeline shares: the Cloud SQL pool,
 * the Gemini client, the step log the loading page reads, and event publishing.
 */
import { Connector } from '@google-cloud/cloud-sql-connector';
import { PubSub } from '@google-cloud/pubsub';
import { GoogleGenAI } from '@google/genai';
import pg from 'pg';

export const MODEL = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';

// One pool per instance, created on first use. The connector authenticates as
// the function's service account, so no IP allow-list is involved.
let poolPromise;
export function getPool() {
  poolPromise ??= (async () => {
    const connector = new Connector();
    const options = await connector.getOptions({
      instanceConnectionName: process.env.INSTANCE_CONNECTION_NAME,
      ipType: 'PUBLIC',
    });
    return new pg.Pool({
      ...options,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      max: 3,
    });
  })();
  return poolPromise;
}

// Created on first use, not at import: a constructor that throws at import
// takes the whole container down before it can report anything useful.
// 2nd-gen functions do not set GOOGLE_CLOUD_PROJECT, so the project is passed in.
let genai;
export function getGenAI() {
  genai ??= new GoogleGenAI({
    vertexai: true,
    project: process.env.PROJECT_ID,
    location: process.env.GEMINI_LOCATION ?? 'global',
  });
  return genai;
}

let pubsub;
/** Publishes one pipeline event as JSON, with its type as an attribute. */
export async function publish(topic, type, data) {
  pubsub ??= new PubSub({ projectId: process.env.PROJECT_ID });
  const id = await pubsub.topic(topic).publishMessage({ json: { type, ...data }, attributes: { type } });
  console.log(`Published ${type} to ${topic} (${id})`);
  return id;
}

/** Decodes the JSON body of a Pub/Sub message delivered by Eventarc. */
export function eventBody(cloudEvent) {
  const raw = cloudEvent.data?.message?.data;
  return raw ? JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) : {};
}

/**
 * Writes steps of the loading page's log for one document. A step is inserted
 * when it starts and updated in place when it settles; its display position
 * (ordinal) is fixed when it is first written, so a step registered early by
 * one function can be settled later by another without moving.
 */
export function stepLog(db, documentId) {
  const startedAt = new Map();
  const upsert = (stepId, ordinal, state, label, detail, ms) =>
    db.query(
      `INSERT INTO intake_events (document_id, step_id, ordinal, label, detail, state, ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (document_id, step_id) DO UPDATE SET
         label = EXCLUDED.label, detail = EXCLUDED.detail, state = EXCLUDED.state,
         ms = EXCLUDED.ms, updated_at = now()`,
      [documentId, stepId, ordinal, label, detail ?? null, state, ms ?? null],
    );

  return {
    async start(stepId, ordinal, label, detail) {
      startedAt.set(stepId, Date.now());
      await upsert(stepId, ordinal, 'start', label, detail);
    },
    async settle(stepId, ordinal, state, label, detail) {
      const at = startedAt.get(stepId);
      await upsert(stepId, ordinal, state, label, detail, at === undefined ? undefined : Date.now() - at);
    },
  };
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Parses a model reply, tolerating a ```json fence or prose around the object. */
export function parseJsonObject(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The model reply had no JSON object.');
  return JSON.parse(body.slice(start, end + 1));
}
