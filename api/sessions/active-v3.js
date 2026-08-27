import { handleActiveV3 } from '../../backend/src/instructor-routes-v4.js';

export default async function handler(req, res) {
  return handleActiveV3(req, res);
}
