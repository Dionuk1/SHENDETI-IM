import { Client, Users, TablesDB, Storage } from 'node-appwrite';
import { AdminError, OPERATIONS, auditFailure, authorizeAdmin, plain, route, text } from './admin.js';

const ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = '6a66216909c3398b7265';

function output(res, status, payload) { return res.json(payload, status); }

export default async ({ req, res, log, error }) => {
  const userId = String(req.headers['x-appwrite-user-id'] || '').trim();
  const key = String(req.headers['x-appwrite-key'] || process.env.APPWRITE_FUNCTION_API_KEY || '').trim();
  if (!userId || !key) return output(res, 401, { ok: false, error: { category: 'unauthenticated', message: 'Authentication required.' } });
  let input = null; let auth = null; let tables = null; let operation = '';
  try {
    input = plain(req.bodyJson); operation = text(input.operation, 'operation', 40, 1);
    if (!OPERATIONS.has(operation)) throw new AdminError('invalid_input', 'Unknown operation.');
    const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(key);
    const users = new Users(client); tables = new TablesDB(client); const storage = new Storage(client); auth = await authorizeAdmin(users, tables, userId);
    const result = await route(users, tables, auth, input, storage);
    log(`Admin operation completed (${operation}).`);
    return output(res, 200, { ok: true, ...result });
  } catch (caught) {
    const known = caught instanceof AdminError; const status = known ? caught.status : (Number(caught?.code) === 429 ? 429 : 500);
    const category = known ? caught.category : (status === 429 ? 'rate_limited' : 'internal_error');
    if (tables && auth) await auditFailure(tables, auth, operation, input, category);
    if (!known) error(`Admin operation failed (${Number(caught?.code) || 500}).`);
    return output(res, status, { ok: false, error: { category, message: known ? caught.message : 'The operation could not be completed.' } });
  }
};
