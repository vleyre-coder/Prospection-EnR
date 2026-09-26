import { construireServeur } from './src/serveur.js';
import { requete, pool } from './src/bdd.js';
const app = await construireServeur({ secretJwt: 'secret-de-test-uniquement' });
const t0 = Date.now();
for (let tour = 1; tour <= 20; tour += 1) {
  const rep = await app.inject({ method: 'POST', url: '/api/qualification/rafraichir', payload: { limite: 50 } });
  const r = rep.json() as { nbParcelles?: number; restant?: number };
  console.log(`tour ${tour} : traitees=${r.nbParcelles ?? 0} restant=${r.restant ?? 0} (${Math.round((Date.now()-t0)/1000)} s)`);
  if (!r.nbParcelles || r.restant === 0) break;
}
await app.close(); await pool.end();
