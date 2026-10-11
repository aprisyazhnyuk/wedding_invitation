'use strict';
const form = document.querySelector('#rsvp-form');
const success = document.querySelector('#success');
const errorBox = document.querySelector('#error');
const submitButton = document.querySelector('#submit');
const attendanceOptions = [['both','На росписи и в ресторане'],['ceremony','Только на росписи'],['restaurant','Только в ресторане'],['none','Не смогу прийти']];
const drinkOptions = ['Красное вино','Белое вино','Игристое','Пиво','Сок','Лимонад','Газировка','Другое'];
let token = '';
let busy = false;
function choice(name, value, label, type) {
  const item = document.createElement('label'); item.className = 'choice';
  const input = document.createElement('input'); input.type = type; input.name = name; input.value = value; input.required = name === 'attendance';
  const span = document.createElement('span'); span.textContent = label;
  item.append(input, span); return item;
}
attendanceOptions.forEach(([value,label]) => document.querySelector('#attendance-options').append(choice('attendance',value,label,'radio')));
drinkOptions.forEach(value => document.querySelector('#drink-options').append(choice('drinks',value,value,'checkbox')));
function updateFields() {
  const restaurant = ['both','restaurant'].includes(form.querySelector('[name=attendance]:checked')?.value);
  document.querySelector('#restaurant').hidden = !restaurant;
  document.querySelectorAll('#restaurant input, #restaurant textarea').forEach(input => { input.disabled = !restaurant; });
  const other = restaurant && Array.from(form.querySelectorAll('[name=drinks]:checked')).some(input => input.value === 'Другое');
  const allergy = restaurant && form.querySelector('[name=allergies]:checked')?.value === 'yes';
  document.querySelector('#other-field').hidden = !other;
  document.querySelector('#allergy-field').hidden = !allergy;
  form.elements.otherDrink.required = other; form.elements.otherDrink.disabled = !other;
  form.elements.allergyDetails.required = allergy; form.elements.allergyDetails.disabled = !allergy;
  form.querySelectorAll('[name=allergies]').forEach(input => { input.required = restaurant; });
}
form.addEventListener('change', updateFields);
updateFields();
function randomHex() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2,'0')).join(''); }
function send(payload) {
  const url = window.WEDDING_CONFIG?.appsScriptUrl || '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) return Promise.reject(new Error('Анкета пока не подключена. Пожалуйста, попробуйте позже.'));
  return new Promise((resolve,reject) => {
    const requestId = randomHex();
    const frame = document.createElement('iframe'); frame.name = 'rsvp-' + requestId; frame.hidden = true; frame.title = 'Отправка анкеты';
    const transport = document.createElement('form'); transport.hidden = true; transport.method = 'POST'; transport.action = url; transport.target = frame.name;
    for (const [name,value] of Object.entries({payload:JSON.stringify(payload),requestId,replyOrigin:location.origin})) {
      const input = document.createElement('input'); input.type='hidden'; input.name=name; input.value=value; transport.append(input);
    }
    let timer;
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message',receive); transport.remove(); frame.remove(); };
    const receive = event => {
      if (!/^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/.test(event.origin)) return;
      const result = event.data;
      if (!result || result.type !== 'wedding-rsvp' || result.requestId !== requestId) return;
      cleanup();
      if (result.ok === true) resolve(); else reject(new Error(result.error || 'Не удалось сохранить ответ. Попробуйте ещё раз.'));
    };
    window.addEventListener('message',receive);
    document.body.append(frame,transport);
    timer = setTimeout(() => { cleanup(); reject(new Error('Не получили подтверждение записи. Проверьте связь и повторите отправку — повтор в этой вкладке не создаст второй ответ.')); },45000);
    transport.submit();
  });
}
form.addEventListener('submit',async event => {
  event.preventDefault(); if (busy) return;
  busy = true; submitButton.disabled = true; submitButton.textContent = 'Сохраняем…'; errorBox.hidden = true;
  const data = new FormData(form); token ||= randomHex();
  const payload = {token,name:data.get('name'),attendance:data.get('attendance'),drinks:data.getAll('drinks'),otherDrink:data.get('otherDrink') || '',allergies:data.get('allergies') || '',allergyDetails:data.get('allergyDetails') || '',dietary:data.get('dietary') || '',website:data.get('website') || ''};
  try {
    await send(payload);
    document.querySelector('#success-text').textContent = `${payload.name}, ваши ответы сохранены.`;
    form.hidden = true; success.hidden = false; success.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  } catch(error) { errorBox.textContent = error.message || 'Не удалось отправить ответ.'; errorBox.hidden = false; }
  finally { busy = false; submitButton.disabled = false; submitButton.textContent = 'Отправить ответ'; }
});
document.querySelector('#edit').addEventListener('click',() => { success.hidden = true; form.hidden = false; });
document.querySelector('#another').addEventListener('click',() => { token = ''; form.reset(); updateFields(); success.hidden = true; form.hidden = false; errorBox.hidden = true; form.elements.name.focus(); });
