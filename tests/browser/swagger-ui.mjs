import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { buildApp } from '../../src/app.ts';
import { prisma } from '../../src/prisma.ts';

// Test the real UI and generated specification without sending business requests.
prisma.apiLog.deleteMany = async () => ({ count: 0 });
prisma.apiLog.create = async () => ({});
const app = await buildApp();
app.log.level = 'silent';
await app.listen({ host: '127.0.0.1', port: 0 });
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) void request.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    else void request.continue();
  });
  await page.goto(`${app.listeningOrigin}/docs/`);
  await page.waitForSelector('.opblock');
  const spec = app.swagger();
  let current;
  async function open(path, method = 'post', fillParams = true) {
    if (current) await page.$eval(current + ' .opblock-summary-control', element => element.click());
    const operation = spec.paths[path][method];
    current = '[id$=' + JSON.stringify('-' + operation.operationId) + ']';
    await page.$eval(current + ' .opblock-summary-control', element => element.click());
    await page.waitForSelector(current + ' .abregi-form');
    await page.waitForFunction(selector => !document.querySelector(selector + ' .abregi-form fieldset').disabled, {}, current);
    for (const parameter of operation.parameters || []) {
      if (fillParams && parameter.in === 'path') await page.type(current + ' input[placeholder=' + JSON.stringify(parameter.name) + ']', 'a'.repeat(43));
    }
  }
  const field = name => current + ' [data-field=' + JSON.stringify(name) + ']';
  const type = (name, value) => page.type(field(name) + ' input:not([type=checkbox])', value);
  const include = name => page.click(field(name) + ' input[aria-label=' + JSON.stringify('Inclure ' + name) + ']');
  async function button(selector, label) {
    await page.$eval(selector, (element, text) => {
      const button = [...element.querySelectorAll('button')].find(b => b.textContent === text);
      if (!button) throw new Error('Missing button: ' + text);
      button.click();
    }, label);
  }
  async function execute() {
    const request = page.waitForRequest(request => new URL(request.url()).pathname.startsWith('/api/'));
    await page.click(current + ' .execute');
    const result = await request;
    assert.match(result.headers()['content-type'], /application\/json/);
    return JSON.parse(result.postData());
  }

  await open('/api/auth/password/login');
  await type('email', 'swagger@example.com');
  await type('password', 'test-password');
  await include('inviteToken');
  await type('inviteToken', 'must-be-omitted');
  await include('inviteToken');
  assert.deepEqual(await execute(), { email: 'swagger@example.com', password: 'test-password' });
  await button(current, 'Reset');
  await page.waitForFunction(selector => document.querySelector(selector + ' [data-field=email] input:not([type=checkbox])').value === '', {}, current);

  await open('/api/equipment');
  await type('name', 'Enceinte');
  await type('category', 'Son');
  await include('quantity');
  await page.$eval(field('quantity') + ' input[type=number]', input => input.select());
  await page.type(field('quantity') + ' input[type=number]', '3');
  await include('ownerId');
  await page.click(field('ownerId') + ' .abregi-null input');
  const equipment = await execute();
  assert.equal(equipment.quantity, 3);
  assert.equal(equipment.ownerId, null);
  assert.equal(equipment.ownership, 'OWNED');
  assert.equal(equipment.vatRateBasisPoints, undefined);

  await open('/api/events/{eventId}/equipment');
  await page.select(current + ' select[aria-label="Variante de Corps de la requête"]', '1');
  await type('name', 'Matériel ponctuel');
  await type('category', 'Son');
  const usage = await execute();
  assert.equal(usage.kind, 'oneoff');
  assert.equal(usage.name, 'Matériel ponctuel');
  assert.equal(usage.itemId, undefined);

  await open('/api/public/volunteers/portal/{token}/planning', 'patch');
  await page.select(field('accept') + ' select', '1');
  await button(field('shifts'), 'Ajouter un élément');
  await type('id', 'shift-1');
  await type('version', '0');
  assert.deepEqual(await execute(), { accept: false, shifts: [{ id: 'shift-1', version: 0 }] });

  await open('/api/uploads/expense-receipts');
  await page.$eval(current + ' input[type=file]', input => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(selector => document.querySelector(selector + ' [role=status]').textContent.includes('receipt.pdf'), {}, current);
  assert.deepEqual(await execute(), { fileName: 'receipt.pdf', contentType: 'application/pdf', data: Buffer.from('receipt').toString('base64') });

  await open('/api/public/volunteers/{token}');
  await type('fullName', 'Camille Test');
  await type('email', 'camille@example.com');
  await button(field('availability'), 'Ajouter un élément');
  const dates = {};
  for (const [name, value] of [['startsAt', '2026-10-01T10:00:00'], ['endsAt', '2026-10-01T12:00:00']]) {
    dates[name] = await page.$eval(field(name) + ' input', (input, value) => {
      if (input.type !== 'datetime-local') throw new Error('Expected date control');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return new Date(value).toISOString();
    }, value);
  }
  await include('answers');
  await page.type(field('answers') + ' input[aria-label="Nouvelle clé pour answers"]', 'question1');
  await button(field('answers'), 'Ajouter un champ');
  await page.select(field('question1') + ' select[aria-label="Variante de question1"]', '1');
  await page.select(field('question1') + ' select:not([aria-label])', '0');
  const application = await execute();
  assert.deepEqual(application.availability, [dates]);
  assert.deepEqual(application.answers, { question1: true });
  console.log('Form submissions verified. Checking rendering of every request body…');

  // Every JSON body must render through the form plugin, including uncommon unions.
  let bodyCount = 0;
  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!operation.requestBody) continue;
      await open(path, method, false);
      assert.equal(await page.$$eval(current + ' textarea.body-param__text', elements => elements.length), 0, path);
      bodyCount++;
      if (bodyCount % 25 === 0) console.log(bodyCount + ' forms rendered');
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Swagger UI: ${bodyCount} forms rendered; JSON types, optional values, unions, arrays and file uploads verified.`);
} finally {
  await browser?.close();
  await app.close();
  await prisma.$disconnect();
}
