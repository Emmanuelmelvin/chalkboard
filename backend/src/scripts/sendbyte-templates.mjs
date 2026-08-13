/**
 * Push the email templates in src/templates/*.html to SendByte.
 *
 * Each file name becomes the template name (used as `template_id` at send
 * time), the `<!-- subject: ... -->` comment becomes the template subject, and
 * a plain-text body is derived from the HTML so every template ships with a
 * `text` fallback. Templates that already exist are updated with PUT, and
 * templates on the account that no longer have a local file are deleted, so
 * the src/templates folder is the source of truth. The script is safe to
 * re-run after editing a file.
 *
 *   node --env-file=.env src/scripts/sendbyte-templates.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiBaseUrl = 'https://api.sendbyte.africa';
const apiKey = process.env.SENDBYTE_API_KEY;

if (!apiKey) {
    console.error('Set SENDBYTE_API_KEY before running this script.');
    process.exit(1);
}

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

async function sendbyte(path, init = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
        const error = payload.error;
        throw new Error(error
            ? `${init.method || 'GET'} ${path} -> ${response.status} ${error.code}: ${error.message}`
            : `${init.method || 'GET'} ${path} -> ${response.status} ${text}`);
    }
    return payload;
}

function htmlToText(html) {
    return html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<head>[\s\S]*?<\/head>/g, '')
        .replace(/<div style="display:none[^"]*"[^>]*>[\s\S]*?<\/div>/g, '')
        .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, '$2 ($1)')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|td|tr|table|h1|h2|h3|li|ul|ol)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&#(\d+);/g, (_, digits) => String.fromCharCode(Number(digits)))
        .replace(/\{\{#[^}]*\}\}/g, '')
        .replace(/\{\{\/[^}]*\}\}/g, '')
        .replace(/\{\{else\}\}/g, '\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const files = readdirSync(templatesDir).filter((file) => file.endsWith('.html')).sort();
const localNames = new Set(files.map((file) => file.replace(/\.html$/, '')));

const list = await sendbyte('/v1/templates');
const existing = new Map((list.data || []).map((template) => [template.name, template]));

for (const [name, template] of existing) {
    if (!localNames.has(name)) {
        await sendbyte(`/v1/templates/${template.id}`, { method: 'DELETE' });
        console.log(`deleted ${name} -> ${template.id}`);
    }
}

for (const file of files) {
    const name = file.replace(/\.html$/, '');
    const raw = readFileSync(join(templatesDir, file), 'utf8');

    const subjectMatch = raw.match(/<!--\s*subject:\s*([\s\S]*?)-->/);
    if (!subjectMatch) {
        console.error(`skip   ${name}: missing "<!-- subject: ... -->" comment`);
        continue;
    }

    const body = { name, subject: subjectMatch[1].trim(), html: raw.trim(), text: htmlToText(raw) };
    const found = existing.get(name);
    if (found) {
        const updated = await sendbyte(`/v1/templates/${found.id}`, { method: 'PUT', body });
        console.log(`updated ${name} -> ${updated.id} (version ${updated.version})`);
    } else {
        const created = await sendbyte('/v1/templates', { method: 'POST', body });
        console.log(`created ${name} -> ${created.id} (version ${created.version})`);
    }
}

console.log('\nDone. Reference these by name as template_id when sending:');
for (const file of files) console.log(`  ${file.replace(/\.html$/, '')}`);
