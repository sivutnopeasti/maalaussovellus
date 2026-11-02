# UGC Suomi -sähköpostihaku

Lukee CSV-tiedoston, tarkistaa yrityksen julkisen Instagram-näkyvyyden ja kirjoittaa viestin vain, jos some on ohut. Viesti ohjaa lomakkeelle: <https://ugcsuomi.fi/ilmoita-kampanjasta-sisallontuottajille/>.

Oletuksena mitään ei lähetetä. Komento tekee `out/tulokset.csv`-tiedoston ja esikatselut.

## Ilmainen polku

| Osa | Hinta | Mitä käytetään |
|---|---|---|
| Yritystiedot | 0 € | PRH avoin YTJ-API |
| Verkkosivu + sähköposti | 0 € | Yrityksen oma sivusto |
| Instagram-luvut | 0 € | Julkinen profiili (`curl`) |
| Instagramin löytäminen | 0 € | Linkki sivulta, `@kahva` tekstistä, tai nimestä johdettu kahva **vain jos tili täsmää yritykseen** |
| Maksettu mainonta | 0 € | Meta Ad Library -token (valinnainen) |
| Lähetys | 0 € | `MAIL_PROVIDER=gmail` tai `brevo` |
| Ajastus | 0 € | Oma cron (`scripts/cron-example.sh`) |
| Tekoäly | vain jos otat käyttöön | `AI_API_KEY` → kahvaehdotuksia / viestin hiontaa |

Suositeltu nollabudjetti (ilman AI:ta):

```bash
cd outreach
npm install
cp .env.example .env
# Muokkaa .env:
# MAIL_PROVIDER=gmail
# SMTP_USER=oma@gmail.com
# SMTP_PASS=sovellussalasana
# OUTREACH_FROM_EMAIL=oma@gmail.com
# OUTREACH_FROM_NAME="UGC Suomi"
# OUTREACH_POSTAL_ADDRESS="..."
node src/cli.mjs --csv yritykset.csv --out out
# kun esikatselut näyttävät hyvältä:
node src/cli.mjs --csv yritykset.csv --out out --send
```

Gmail: Google-tili → kaksivaiheinen vahvistus → [sovellussalasana](https://myaccount.google.com/apppasswords). Päivärajat ovat tyypillisesti satoja viestejä; pidä `--delay-ms` vähintään 1500–3000.

Brevo: ilmainen SMTP ~300 viestiä/vrk, aseta `MAIL_PROVIDER=brevo`.

## CSV

Tarvitaan vähintään nimi ja Y-tunnus. Verkkosivu, sähköposti ja Instagram ovat vapaaehtoisia. Erotin voi olla puolipiste tai pilkku.

```csv
nimi;y_tunnus;verkkosivu
Esimerkki Oy;1234567-8;https://esimerkki.fi
```

## Arvio

Yritys jätetään rauhaan, jos yksikin näistä toteutuu:

- vähintään 3000 seuraajaa
- julkaisujen tykkäysten mediaani ≥ 30
- kommenttien mediaani ≥ 3
- videoiden katseluiden mediaani ≥ 1000
- aktiivinen Meta-mainos Suomessa (vain jos `META_ACCESS_TOKEN` on asetettu)

Muuten tili on heikko. Jos lukuja ei saada, viestiä ei tehdä. Yksityistä elinkeinonharjoittajaa ei kontaktoida.

## Valinnainen tekoäly

Ilman avainta kaikki yllä toimii. Kun asetat `AI_API_KEY` (tai `OPENAI_API_KEY`):

1. tekoäly voi ehdottaa Instagram-kahvoja, jos sivulla ei ole linkkiä — kahva hyväksytään vain, jos julkinen tili täsmää yritykseen
2. tekoäly voi hioa viestin tekstin

OpenAI-yhteensopiva rajapinta, joten voit käyttää myös ilmaisia tai lähes ilmaisia malleja:

```bash
# Groq (usein ilmainen kiintiö)
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.1-8b-instant
AI_API_KEY=...

# OpenRouter free-mallit
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=openai/gpt-oss-20b:free
AI_API_KEY=...
```

## Ajo

```bash
node src/cli.mjs --csv yritykset.csv --out out
node src/cli.mjs --csv yritykset.csv --send --mail-provider gmail
```

`--send` vaatii lähettäjän nimen, sähköpostin, postiosoitteen ja SMTP:n (`MAIL_PROVIDER` tai `SMTP_HOST`). Viestissä on ohje vastata "Ei kiitos". Estolista: `suppression.txt`. Jo lähetetyt: `out/lahetetyt.jsonl`.

Tarkistukset: `npm test`.
