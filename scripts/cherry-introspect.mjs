// Try various Cherry API endpoints and auth strategies
const API_KEY = 'B-x6kkiusEBHOhHDvCnyHBGEQmaNQGhF';

const endpoints = [
  'https://gql.withcherry.com/',
  'https://gql.withcherry.com/graphql',
  'https://api.withcherry.com/graphql',
  'https://api.withcherry.com/',
  'https://api.withcherry.com/v1/graphql',
  'https://gql.withcherry.com/v1',
];

const simpleQuery = `{ fetchLoans { success total } }`;

const auths = [
  ['Bearer', { 'Authorization': `Bearer ${API_KEY}` }],
  ['X-Api-Key', { 'X-Api-Key': API_KEY }],
  ['Api-Key', { 'Api-Key': API_KEY }],
  ['x-cherry-api-key', { 'x-cherry-api-key': API_KEY }],
  ['x-api-key lowercase', { 'x-api-key': API_KEY }],
];

async function main() {
  for (const endpoint of endpoints) {
    console.log(`\n=== ${endpoint} ===`);
    for (const [name, headers] of auths) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ query: simpleQuery }),
        });
        const text = await res.text();
        const snippet = text.replace(/\s+/g, ' ').substring(0, 150);
        console.log(`  [${name}] ${res.status}: ${snippet}`);

        if (res.status === 200) {
          try {
            const d = JSON.parse(text);
            if (d.data || d.errors) {
              console.log(`  >>> WORKS! Full response: ${text.substring(0, 500)}`);
            }
          } catch { }
        }
        if (res.status === 400) {
          // 400 means auth worked but query is wrong - useful!
          console.log(`  >>> AUTH LIKELY WORKS (400): ${text.substring(0, 500)}`);
        }
      } catch (e) {
        console.log(`  [${name}] ERROR: ${e.message}`);
      }
    }
  }
}

main().catch(console.error);
