import { handleInstructorDaily } from '../../../backend/src/instructor-routes.js';

export default async function handler(req, res) {
  return handleInstructorDaily(req, res, req.query?.id || null);
}
