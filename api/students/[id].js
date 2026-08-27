import studentsHandler from '../students.js';

export default async function handler(req,res){
  return studentsHandler(req,res);
}
