import { handleInstructorRequest } from '../backend/src/instructor-routes.js';

export default async function handler(req, res) {
  return handleInstructorRequest(req, res, null);
}
