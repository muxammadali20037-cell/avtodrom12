import { handleActiveV3 } from '../../backend/src/instructor-routes.js';

export default async function handler(req, res) {
  return handleActiveV3(req, res);
}
