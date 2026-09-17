# Backend skeleton – Redis ticketing practice

Minimální Bun + TypeScript (strict) + Fastify server. Better Auth používá PostgreSQL (`pg`) pro uživatele a účty, Redis (`redis` / node-redis) jako vlastní `secondaryStorage` pro session a krátkodobá auth data. Drizzle ORM je připravené pro aplikační tabulky nad stejným PostgreSQL poolem. Funkce pro vstupenky záměrně nejsou součástí projektu.

Importy souborů z `src` používají alias `#src/*` definovaný v `package.json`. Například `#src/auth/session` odkazuje na `src/auth/session.ts`; alias funguje v Bunu i při kontrole TypeScriptem.

## Spuštění

Požadavky: Bun, Docker s Docker Compose a `curl`. V kořeni projektu:

```sh
bun install --frozen-lockfile
# Pokud .env ještě neexistuje:
cp .env.example .env
```

V `.env` nastav vlastní náhodné `BETTER_AUTH_SECRET` (alespoň 32 znaků; lze vytvořit `openssl rand -hex 32`). Změň `POSTGRES_PASSWORD` a nastav **stejné heslo** také v `DATABASE_URL` (pokud obsahuje speciální znaky, URL-encode). `.env` je ignorovaný; `.env.example` obsahuje jen zástupné hodnoty. V tomto pracovním adresáři je už lokální `.env` vygenerovaný, takže `cp` znovu nespouštěj, pokud jej nechceš nahradit. Databáze naslouchají na host portech 5433 a 6380, aby nekolidovaly s jinými lokálními službami. Pokud změníš `POSTGRES_PORT` nebo `REDIS_PORT`, změň současně port v příslušné URL. Výchozí API je `http://localhost:3100`, povolený frontend origin je `http://localhost:5173` (frontend zde není). Při změně `PORT` změň také `BETTER_AUTH_URL`.

```sh
docker compose up -d --wait
bun run auth:migrate
bun run db:migrate
bun run db:seed
bun run dev
# V druhém terminálu:
bun run worker:outbox
```

`auth:migrate` spustí připnutou Better Auth CLI nad `src/auth/auth.ts` a vytvoří potřebné auth tabulky v PostgreSQL. `db:migrate` vytvoří aplikační tabulky `concerts`, `concert_favorites` a `popularity_outbox`; spouštěj ho až po `auth:migrate`, protože oblíbené mají cizí klíč na uživatele Better Auth. `db:seed` vloží deset fiktivních koncertů do PostgreSQL, obnoví PostgreSQL-podložený Redis žebříček a přidá koncerty s nulovým skóre do odděleného Redis-only žebříčku (`ZADD NX`, takže jeho skóre při opakování nenuluje). `dev` sleduje změny; bez watcheru použij `bun run start`. `worker:outbox` je samostatný proces pro doručování změn žebříčku do Redis a musí běžet vedle API. `bun run typecheck` provede striktní kontrolu typů. PostgreSQL a Redis se uchovávají v pojmenovaných Docker volumes; `docker compose down` data nemaže. Při změně hesla již existující PostgreSQL volume heslo automaticky nepřevezme — uprav přihlašovací údaje v databázi, nebo vědomě odstraň volume, pokud data nepotřebuješ.

## Drizzle

Sdílená Drizzle instance je `db` v `src/db/drizzle.ts`; používá existující `pg` pool a je dostupná pro aplikační dotazy. Nové tabulky definuj v `src/db/schema.ts`, pak spusť:

```sh
bun run db:generate
bun run db:migrate
```

Vygenerované SQL a metadata v `drizzle/` ponech v projektu. Better Auth nadále vlastní tabulky `user` a `account` a migruje je přes `auth:migrate`; nepřidávej je do aplikačního Drizzle schématu. To zachovává kompatibilitu s existující databází a vyhýbá se dvojím migracím týchž tabulek.

## Oblíbené a žebříček

Zdroj pravdy pro oblíbené je PostgreSQL tabulka `concert_favorites` s unikátní dvojicí `(user_id, concert_id)`. `PUT /api/me/favorites/:concertId` použije `ON CONFLICT DO NOTHING`, takže opakované i souběžné přidání nevytvoří duplicitu. Při prvním přidání uloží v **téže PostgreSQL transakci** i úkol do `popularity_outbox` a odešle `NOTIFY` (až při commitu). Redis sorted set `app:concerts:popularity` je odvozený žebříček: samostatný worker drží vyhrazené `LISTEN` spojení, po probuzení vyzvedne všechny čekající úkoly, načte aktuální počet oblíbených z PostgreSQL a nastaví skóre v Redis. Při startu zpracuje backlog; po ztrátě spojení se znovu připojí a každých 30 sekund provede kontrolní dotaz pro případ zmeškané notifikace. `NOTIFY` je jen signál, trvalé úkoly zůstávají v outbox tabulce. `ZADD GT` brání tomu, aby starší souběžný úkol snížil novější skóre; tento postup počítá s tím, že se oblíbené zatím pouze přidávají. Pokud Redis aktualizace selže, úkol zůstane v PostgreSQL a worker jej za sekundu zkusí znovu. Pokud Redis zápis uspěje, ale potvrzení úkolu v PostgreSQL ne, opakování je bezpečné díky nastavení absolutního skóre. Žebříček se tedy může krátce po `PUT` opožďovat; bez spuštěného workeru se sám neaktualizuje. Obnoví se také při startu serveru.

Při ztrátě nebo rozchodu dat v Redis zastav API zápisy i worker a spusť `bun run db:rebuild-popularity`. Příkaz nahradí žebříček počty z PostgreSQL, včetně koncertů s nulou; během obnovy nesmí současně přibývat oblíbené ani běžet doručování. Původní Redis sety `app:favorites:*` se už nepoužívají. Pokud je máš v jiné instalaci naplněné, před přepnutím je nejdřív převeď do `concert_favorites`; v tomto lokálním projektu při změně žádné takové sety nebyly.

Pro porovnání je navíc `PUT /api/me/redis-favorites/:concertId`. Ověří přihlášení a existenci koncertu stejně jako PostgreSQL varianta, ale samotné oblíbené ukládá **jen v Redis**: do setu `app:redis-only:favorites:<userId>` a do sorted setu `app:redis-only:concerts:popularity`. Lua skript spojí `SADD` s podmíněným `ZINCRBY` atomicky. Obě varianty vracejí `{ "added": true | false }`, jejich hlasy se však záměrně nesčítají a Redis-only data nelze obnovit z PostgreSQL.

```sh
curl -i -b cookies.txt -X PUT http://localhost:3100/api/me/favorites/concert-01
curl -i -b cookies.txt -X PUT http://localhost:3100/api/me/redis-favorites/concert-01
curl -i http://localhost:3100/api/concerts/popular
docker compose exec -T redis redis-cli ZRANGE app:redis-only:concerts:popularity 0 2 REV WITHSCORES
```

HTTP žebříček ukazuje PostgreSQL-podloženou variantu; poslední příkaz ukáže nezávislé top 3 Redis-only varianty.

## Testy

S běžícím PostgreSQL a Redis a po migracích spusť `bun run test`. Integrační testy používají skutečné databáze, ale vytvářejí jen jednoznačně pojmenované dočasné uživatele, koncerty a Redis klíče, které po testu odstraní. Session je v testech nahrazená; běžné žebříčky se nemění. `bun run typecheck` kontroluje také testy.

## První requesty

V dalším terminálu spusť přesně v uvedeném pořadí. `cookies.txt` uchovává session cookie a je ignorovaný v `.gitignore`.

```sh
curl -i http://localhost:3100/health

curl -i -c cookies.txt -b cookies.txt \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
  -d '{"name":"Test User","email":"test@example.com","password":"password1234"}' \
  http://localhost:3100/api/auth/sign-up/email

curl -i -c cookies.txt -b cookies.txt \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
  -d '{"email":"test@example.com","password":"password1234"}' \
  http://localhost:3100/api/auth/sign-in/email

curl -i -b cookies.txt http://localhost:3100/api/me

curl -i -c cookies.txt -b cookies.txt \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
  -d '{}' http://localhost:3100/api/auth/sign-out

curl -i -b cookies.txt http://localhost:3100/api/me
```

Poslední `/api/me` vrátí 401. Pro opakování registrace změň email; po první registraci jde testovat už jen přihlášení. `GET /health` vrací 503, pokud není dostupná PostgreSQL nebo Redis. `requireSession()` v `src/auth/session.ts` je společná kontrola pro další chráněné route a při chybějící session vyvolá 401.

Auth klíče mají prefix `auth:`. `getAndDelete` používá Redis `GETDEL`; `increment` používá atomické `MULTI/EXEC` s `INCR` a `EXPIRE NX`, takže další inkrementy neposouvají původní expiraci. TTL jsou v sekundách. Docker Compose používá Redis 8.10.1. Před prvním spuštěním nové verze nad existujícím `redis_data` volume zálohuj data, pokud je chceš zachovat. CORS pouští pouze `FRONTEND_ORIGIN` s credentials, stejný origin je v Better Auth `trustedOrigins`.

Lokální kontejnery zastavíš pomocí `docker compose down`; databázová data přitom zůstanou zachována.

Dokumentace: [Fastify integrace](https://better-auth.com/docs/integrations/fastify), [secondary storage](https://better-auth.com/docs/concepts/database#secondary-storage), [PostgreSQL](https://better-auth.com/docs/adapters/postgresql), [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql), [Drizzle migrace](https://orm.drizzle.team/docs/drizzle-kit-migrate).
