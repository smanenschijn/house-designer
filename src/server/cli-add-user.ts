import { createUser, findUser, initAuth, updateUser } from './auth';

// Noodtoegang / beheer vanaf de server:
//   npm run user:add -- <gebruikersnaam> <weergavenaam> <wachtwoord>
// Bestaat de gebruiker al, dan wordt het wachtwoord opnieuw ingesteld.
const [username, displayName, password] = process.argv.slice(2);
if (!username || !displayName || !password) {
  console.error('Gebruik: npm run user:add -- <gebruikersnaam> <weergavenaam> <wachtwoord>');
  process.exit(1);
}
initAuth();
const existing = findUser(username);
const u = existing ? updateUser(existing.id, { displayName, password }) : createUser({ username, displayName, password });
console.log(`Gebruiker ${existing ? 'bijgewerkt' : 'aangemaakt'}: ${u.username} (${u.displayName})`);
