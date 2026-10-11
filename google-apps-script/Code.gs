/** Bound to your private Google Sheet. Run setup() once before deployment. */
const ALLOWED_ORIGIN = 'https://aprisyazhnyuk.github.io';
const SHEET_NAME = 'Ответы гостей';
const HEADERS = ['Имя и фамилия','Участие','Напитки','Другие напитки','Аллергии','Продукты / детали','Ограничения питания','Первый ответ','Обновлено','Служебный ключ'];
const ATTENDANCE = {both:'Роспись и ресторан',ceremony:'Только роспись',restaurant:'Только ресторан',none:'Не придёт'};
const DRINKS = ['Красное вино','Белое вино','Игристое','Пиво','Сок','Лимонад','Газировка','Другое'];

function setup() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Откройте Apps Script через меню Расширения в вашей таблице.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', book.getId());
  const sheet = book.getSheetByName(SHEET_NAME) || book.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#164c3a').setFontColor('#ffffff');
  sheet.getRange('H:I').setNumberFormat('dd.MM.yyyy HH:mm');
  sheet.setColumnWidths(1,7,190);
  sheet.setColumnWidths(8,2,150);
  sheet.hideColumns(10);
  book.setSpreadsheetTimeZone('Europe/Moscow');
}

function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Проверьте заполнение анкеты.');
  function text(key, maximum) {
    if (raw[key] == null) return '';
    if (typeof raw[key] !== 'string' || raw[key].length > maximum) throw new Error('Проверьте длину текста в анкете.');
    return raw[key].trim();
  }
  const name = text('name',120);
  const token = text('token',64);
  if (name.length < 2 || !/^[a-f0-9]{64}$/.test(token) || text('website',1200)) throw new Error('Проверьте заполнение анкеты.');
  if (!Object.prototype.hasOwnProperty.call(ATTENDANCE,raw.attendance)) throw new Error('Выберите, будете ли вы на празднике.');
  const restaurant = raw.attendance === 'both' || raw.attendance === 'restaurant';
  const result = {name,token,attendance:raw.attendance,drinks:[],otherDrink:'',allergies:'',allergyDetails:'',dietary:''};
  if (restaurant) {
    if (!Array.isArray(raw.drinks) || raw.drinks.length > DRINKS.length || raw.drinks.some(drink => !DRINKS.includes(drink))) throw new Error('Проверьте выбор напитков.');
    result.drinks = [...new Set(raw.drinks)];
    if (result.drinks.includes('Другое')) {
      result.otherDrink = text('otherDrink',1200);
      if (!result.otherDrink) throw new Error('Уточните ваши предпочтения по напиткам.');
    }
    if (!['yes','no'].includes(raw.allergies)) throw new Error('Укажите, есть ли пищевые аллергии.');
    result.allergies = raw.allergies;
    if (raw.allergies === 'yes') {
      result.allergyDetails = text('allergyDetails',1200);
      if (!result.allergyDetails) throw new Error('Укажите продукты, на которые есть аллергия.');
    }
    result.dietary = text('dietary',1200);
  }
  return result;
}

function safeCell(value) { return /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value; }

function saveResponse(raw) {
  const data = validate(raw);
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Сначала выполните setup.');
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,data.token).map(n => ('0' + ((n + 256) % 256).toString(16)).slice(-2)).join('');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(id).getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getRange(1,10).getValue() !== HEADERS[9]) throw new Error('Проверьте настройку таблицы.');
    const lastRow = sheet.getLastRow();
    const hashes = lastRow > 1 ? sheet.getRange(2,10,lastRow-1,1).getValues() : [];
    const found = hashes.findIndex(row => row[0] === hash);
    const row = found < 0 ? lastRow + 1 : found + 2;
    const now = new Date();
    const created = found < 0 ? now : sheet.getRange(row,8).getValue();
    const values = [data.name,ATTENDANCE[data.attendance],data.drinks.join(', '),data.otherDrink,data.allergies === 'yes' ? 'Да' : data.allergies === 'no' ? 'Нет' : '',data.allergyDetails,data.dietary].map(safeCell);
    sheet.getRange(row,1,1,10).setValues([[...values,created,now,hash]]);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

function doGet() {
  return HtmlService.createHtmlOutput('<p>Обработчик свадебной анкеты. Ответы гостей здесь не отображаются.</p>');
}

function doPost(event) {
  const parameters = event && event.parameter || {};
  const requestId = /^[a-f0-9]{64}$/.test(parameters.requestId || '') ? parameters.requestId : '';
  let result = {type:'wedding-rsvp',requestId,ok:false,error:'Не удалось сохранить ответ. Пожалуйста, попробуйте ещё раз.'};
  try {
    if (parameters.replyOrigin !== ALLOWED_ORIGIN || !requestId) throw new Error('Неверный адрес отправки.');
    if (typeof parameters.payload !== 'string' || parameters.payload.length > 16000) throw new Error('Некорректная анкета.');
    saveResponse(JSON.parse(parameters.payload));
    result = {type:'wedding-rsvp',requestId,ok:true};
  } catch (error) {
    // Only validation messages are returned; spreadsheet IDs and internal errors stay private.
    if (/^(Проверьте|Выберите|Укажите|Уточните)/.test(String(error.message))) result.error = error.message;
    console.error('RSVP save failed: ' + error.message);
  }
  const json = JSON.stringify(result).replace(/</g,'\\u003c');
  return HtmlService.createHtmlOutput('<!doctype html><html><body><script>window.top.postMessage(' + json + ',' + JSON.stringify(ALLOWED_ORIGIN) + ');</script></body></html>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
