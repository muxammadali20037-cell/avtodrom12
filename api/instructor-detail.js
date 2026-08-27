import { handleInstructorRequest } from '../backend/src/instructor-routes-v4.js';

export default async function handler(req, res) {
  return handleInstructorRequest(req, res, req.query?.id || null);
}
