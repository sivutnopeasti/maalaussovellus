# Maalausyritys - Asiakassovellus

Mobiilisovellus maalausyrityksen asiakkaille. Asiakas näkee urakan kulun, voi keskustella maalareiden ja työnjohdon kanssa chatissa, seurata dokumentteja ja työn vaiheita.

## Rakenne

```
apps/
  mobile/     # Expo React Native -mobiilisovellus (iOS + Android)
  admin/      # React web-hallintapaneeli (Cloudflare Pages)
supabase/
  migrations/ # Tietokantamigraatiot
  functions/  # Edge Functions (push-ilmoitukset)
```

## Käyttöönotto

### 1. Supabase-projekti

1. Luo tili: https://supabase.com
2. Luo uusi projekti
3. Avaa **SQL Editor** ja suorita tiedostot järjestyksessä:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_push_notification_trigger.sql`
4. Kopioi projektin **URL** ja **anon key** kohdasta **Settings > API**

### 2. Mobiilisovellus (kehitys)

```bash
cd apps/mobile
cp .env.example .env
# Muokkaa .env-tiedostoon Supabase URL ja anon key
npm start
```

Skannaa QR-koodi Expo Go -sovelluksella (saatavilla App Storesta ja Google Playsta).

### 3. Hallintapaneeli (kehitys)

```bash
cd apps/admin
cp .env.example .env
# Muokkaa .env-tiedostoon Supabase URL ja anon key
npm run dev
```

### 4. Admin-käyttäjän luonti

1. Rekisteröidy sovelluksessa tai Supabase Dashboardissa (**Authentication > Users**)
2. Supabase SQL Editorissa muuta rooli adminiksi:
   ```sql
   UPDATE profiles SET role = 'admin' WHERE email = 'sinun@email.fi';
   ```

### 5. Hallintapaneelin julkaisu (Cloudflare Pages)

```bash
cd apps/admin
npm run build
```

1. Mene Cloudflare Dashboardiin > Pages
2. Yhdistä GitHub-repositorio TAI lataa `dist/`-kansio
3. Aseta ympäristömuuttujat:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

### 6. Mobiilisovelluksen julkaisu

#### Valmistelu

```bash
cd apps/mobile
npm install -g eas-cli
eas login
```

#### Android (Google Play)

```bash
eas build --platform android --profile production
eas submit --platform android
```

#### iOS (App Store)

```bash
eas build --platform ios --profile production
eas submit --platform ios
```

## Tarvittavat tilit

| Palvelu | URL | Hinta |
|---------|-----|-------|
| Supabase | supabase.com | Ilmainen |
| Expo | expo.dev | Ilmainen |
| Apple Developer | developer.apple.com | 99 $/vuosi |
| Google Play | play.google.com/console | 25 $ (kerta) |
| Cloudflare | cloudflare.com | Ilmainen |

## Push-ilmoitukset

Push-ilmoitukset vaativat:
1. Ota käyttöön `pg_net` -laajennus Supabase Dashboardissa (Database > Extensions)
2. Deploya Edge Function: `supabase functions deploy send-push-notification`
3. Aseta Supabase-asetukset (Database > Settings):
   - `app.settings.supabase_url`
   - `app.settings.service_role_key`
