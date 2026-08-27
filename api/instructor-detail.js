import instructorsHandler from './instructors.js';

export default async function handler(req,res){
  return instructorsHandler(req,res);
}
