import { upsertUser } from './auth';

// Gebruik: npm run user:add -- <gebruikersnaam> <weergavenaam> <wachtwoord>
const [username, displayName, password] = process.argv.slice(2);
if (!username || !displayName || !password) {
  console.error('Gebruik: npm run user:add -- <gebruikersnaam> <weergavenaam> <wachtwoord>');
  process.exit(1);
}
const u = upsertUser(username.toLowerCase(), displayName, password);
console.log(`Gebruiker opgeslagen: ${u.username} (${u.displayName})`);
