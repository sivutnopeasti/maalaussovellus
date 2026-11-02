import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsv, rowFromRecord, toCsv } from './csv.mjs';
import { assessPresence, usernameFromInstagram } from './score.mjs';
import { fetchAds, fetchInstagram, fetchSite, lookupCompany, normalizeWebsite, pickEmail } from './sources.mjs';
import { buildMessage } from './template.mjs';

export async function loadRows(csvPath) {
  const text = await readFile(csvPath, 'utf8');
  return parseCsv(text).map(rowFromRecord).filter((row) => row.name || row.businessId);
}

export async function evaluateCompany(input, deps, options) {
  const result = blankResult(input);
  let officialName = input.name;

  if (input.businessId && deps.lookupCompany) {
    let company = null;
    try {
      company = await deps.lookupCompany(input.businessId);
    } catch (error) {
      result.decision = 'unknown';
      result.reasons = [`Kaupparekisterihaku epäonnistui: ${error.message}`];
      return finish(result, options);
    }
    if (!company) {
      result.decision = 'unknown';
      result.reasons = ['Y-tunnusta ei löytynyt kaupparekisteristä'];
      return finish(result, options);
    }
    officialName = company.name || officialName;
    result.name = officialName;
    if (!result.website) result.website = company.website || '';
    if (company.naturalPerson) {
      result.decision = 'skip';
      result.reasons = ['Yksityinen elinkeinonharjoittaja jätetään väliin'];
      return finish(result, options);
    }
    if (company.dissolved) {
      result.decision = 'skip';
      result.reasons = ['Yritys ei ole kaupparekisterissä aktiivinen'];
      return finish(result, options);
    }
  }

  if (!result.businessId) {
    result.decision = 'unknown';
    result.reasons = ['Y-tunnus puuttuu tai on väärän muotoinen'];
    return finish(result, options);
  }

  result.website = normalizeWebsite(result.website);
  let site = { ok: false, instagram: '', email: '' };
  if (result.website) {
    try {
      site = await deps.fetchSite(result.website);
    } catch (error) {
      site = { ok: false, instagram: '', email: '', error: error.message };
    }
  }
  if (!result.instagram && site.instagram) result.instagram = site.instagram;
  if (!result.email && site.email) result.email = site.email;

  const instagramUsername = usernameFromInstagram(result.instagram);
  let profile = null;
  let instagramError = '';
  if (instagramUsername) {
    try {
      profile = await deps.fetchInstagram(instagramUsername);
      if (profile?.username) result.instagram = `https://www.instagram.com/${profile.username}/`;
      if (!result.email && profile?.businessEmail) {
        result.email = pickEmail([profile.businessEmail], result.website || profile.externalUrl || '');
      }
    } catch (error) {
      instagramError = error.message;
    }
  }

  let ads = { checked: false, active: null };
  try {
    ads = await deps.fetchAds(officialName);
  } catch {
    ads = { checked: false, active: null };
  }
  result.activeAds = ads.checked ? (ads.active ? 'kyllä' : 'ei') : 'ei tarkistettu';

  const assessment = assessPresence({
    website: result.website,
    websiteFetchFailed: Boolean(result.website) && site.ok === false && !profile,
    instagramUsername,
    instagramError,
    profile,
    ads,
  }, options.thresholds);

  result.decision = assessment.decision;
  result.reasons = assessment.reasons;
  result.followers = assessment.followers ?? '';
  result.medianLikes = assessment.medianLikes ?? '';
  result.medianComments = assessment.medianComments ?? '';
  result.medianViews = assessment.medianViews ?? '';
  return finish(result, options);
}

export async function processFile({ csvPath, outDir, options, deps, deliver }) {
  const rows = await loadRows(csvPath);
  const suppression = await loadSuppression(options.suppressionPath);
  const sent = await loadSent(options.sentPath);
  await mkdir(outDir, { recursive: true });
  const limited = rows.slice(0, options.limit || rows.length);
  const results = [];

  for (let index = 0; index < limited.length; index += 1) {
    const input = limited[index];
    const result = await evaluateCompany(input, deps, options);
    result.delivery = 'ei lähetetä';
    if (result.decision === 'weak') {
      const message = buildMessage({
        companyName: result.name,
        businessId: result.businessId,
        instagramUrl: result.instagram,
        reasons: result.reasons,
        fromName: options.fromName,
        fromEmail: options.fromEmail,
        postalAddress: options.postalAddress,
      });
      const previewName = `${safeName(result.businessId || result.name)}.txt`;
      await writeFile(path.join(outDir, previewName), `${message.subject}\n\n${message.text}\n`, 'utf8');
      result.delivery = await maybeSend({ result, message, options, suppression, sent, deliver });
    }
    results.push(result);
    console.log(`${result.businessId || '–'}  ${result.name}  ${result.decision}  ${result.delivery}`);
    if (index < limited.length - 1 && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  }

  await writeFile(path.join(outDir, 'tulokset.csv'), toCsv(results), 'utf8');
  return results;
}

async function maybeSend({ result, message, options, suppression, sent, deliver }) {
  if (!result.email) return 'ei sähköpostia';
  if (suppression.has(result.email)) return 'estolistalla';
  if (sent.has(result.businessId)) return 'lähetetty aiemmin';
  if (!options.send) return 'esikatselu';
  if (!options.fromEmail || !options.fromName || !options.postalAddress) {
    return 'lähettäjän nimi, sähköposti tai postiosoite puuttuu';
  }
  await deliver({
    to: result.email,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: {
      'List-Unsubscribe': `<mailto:${options.fromEmail}?subject=Ei%20kiitos>`,
    },
  });
  await appendFile(options.sentPath, `${JSON.stringify({ businessId: result.businessId, email: result.email, at: new Date().toISOString() })}\n`);
  sent.add(result.businessId);
  return 'lähetetty';
}

function finish(result, options) {
  result.reasons = result.reasons || [];
  if (result.decision === 'weak' && options) return result;
  return result;
}

function blankResult(input) {
  return {
    name: input.name || '',
    businessId: input.businessId || '',
    website: input.website || '',
    instagram: input.instagram || '',
    email: input.email || '',
    followers: '',
    medianLikes: '',
    medianComments: '',
    medianViews: '',
    activeAds: 'ei tarkistettu',
    decision: 'unknown',
    reasons: [],
    delivery: '',
  };
}

async function loadSuppression(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    return new Set(text.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter((line) => line && !line.startsWith('#')));
  } catch {
    return new Set();
  }
}

async function loadSent(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    const ids = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).businessId);
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_') || 'yritys';
}

export function defaultDeps(env = process.env) {
  return {
    lookupCompany,
    fetchSite,
    fetchInstagram,
    fetchAds: (name) => fetchAds(name, env.META_ACCESS_TOKEN || ''),
  };
}
