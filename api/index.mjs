// Entrada da Vercel: uma função só atende todas as rotas (o vercel.json manda tudo
// para cá). O tratador é o mesmo do VPS — ver servidor/src/app.mjs.
import { tratar } from "../servidor/src/app.mjs";

export default tratar;
