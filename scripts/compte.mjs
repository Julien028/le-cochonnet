// Crée un compte (ou redonne un mot de passe) directement dans la base, sans passer par l'appli.
// Sert pour le tout premier compte (administrateur principal) et en secours.
//
//   node scripts/compte.mjs <identifiant> <principal|admin|organisateur> "<Nom>"
//
// Affiche le mot de passe provisoire et la commande à lancer. Avec --local, vise la base de test.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hacher } from '../src/session.js';

const [identifiant, role, nom = ''] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const local = process.argv.includes('--local');
if (!identifiant || !['principal', 'admin', 'organisateur'].includes(role)) {
  console.error('Usage : node scripts/compte.mjs <identifiant> <principal|admin|organisateur> "<Nom>" [--local]');
  process.exit(1);
}

const mots = ['boule', 'carreau', 'pointe', 'tireur', 'mene', 'terrain', 'cochonnet', 'triplette', 'doublette', 'fanny', 'palet'];
const n = crypto.getRandomValues(new Uint32Array(3));
const motDePasse = `${mots[n[0] % mots.length]}-${1000 + (n[1] % 9000)}-${mots[n[2] % mots.length]}`;
const hash = await hacher(motDePasse);
const q = s => `'${String(s).replace(/'/g, "''")}'`;

const sql = `INSERT INTO comptes (identifiant, nom, role, mot_de_passe) VALUES (${q(identifiant)}, ${q(nom)}, ${q(role)}, ${q(hash)})
ON CONFLICT (identifiant) DO UPDATE SET mot_de_passe = excluded.mot_de_passe, actif = 1`;

// Passé par un fichier : sur la ligne de commande, le shell abîmerait les « $ » de l'empreinte
const fichier = join(tmpdir(), `compte-${identifiant}.sql`);
writeFileSync(fichier, sql + ';\n');

console.log(`Identifiant : ${identifiant}\nMot de passe provisoire : ${motDePasse}\n`);
console.log(`npx wrangler d1 execute le-cochonnet ${local ? '--local' : '--remote'} --file "${fichier}"`);
