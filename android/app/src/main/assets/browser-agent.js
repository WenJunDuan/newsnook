/* NewsNook Agent: scoped DOM observation and vetted browser actions. */
(function () {
  'use strict';
  var args = __ARGS__;
  var cap = 90;
  var selector = 'a[href],button,input,textarea,select,[role="button"],[role="textbox"],[role="link"],[contenteditable="true"],[tabindex]';
  function visible(el) {
    var r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  }
  function elements() {
    return Array.prototype.filter.call(document.querySelectorAll(selector), visible).slice(0, cap);
  }
  function label(el) {
    if (el.matches('input[type=password],[autocomplete=current-password],[autocomplete=new-password]')) return '[受保护的密码输入框]';
    return (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.getAttribute('title') || '').trim().replace(/\s+/g,' ').slice(0, 120);
  }
  try {
    if (args.action === 'observe') {
      var nodes = elements();
      var items = nodes.map(function (el, i) {
        var r = el.getBoundingClientRect();
        return {id:i, tag:el.tagName.toLowerCase(), role:el.getAttribute('role') || '', text:label(el),
          type:el.getAttribute('type') || '', href:el.getAttribute('href') || '',
          x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
      });
      var body = (document.body && document.body.innerText || '').replace(/\n{3,}/g,'\n\n').slice(0, 14500);
      return JSON.stringify({url:location.href,title:document.title, viewport:{width:innerWidth,height:innerHeight}, text:body, elements:items});
    }
    if (args.action === 'scroll') {
      window.scrollBy({top:args.direction === 'up' ? -Math.round(innerHeight*.75) : Math.round(innerHeight*.75),behavior:'instant'});
      return JSON.stringify({ok:true});
    }
    var el = elements()[args.id];
    if (!el || !visible(el)) return JSON.stringify({error:'元素不存在，重新观察网页'});
    el.scrollIntoView({block:'center', inline:'nearest'});
    if (args.action === 'click') { el.click(); return JSON.stringify({ok:true}); }
    if (args.action === 'type') {
      if (el.disabled || el.readOnly || el.matches('input[type=password],[autocomplete=current-password],[autocomplete=new-password]')) return JSON.stringify({error:'受保护的输入框须用户手动填写'});
      var tag = el.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && !el.isContentEditable && el.getAttribute('role') !== 'textbox') return JSON.stringify({error:'目标不是输入框'});
      el.focus();
      var value = String(args.text || '').slice(0, 4000);
      if (el.isContentEditable) { el.textContent = value; }
      else {
        var proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto,'value').set;
        setter.call(el,value);
      }
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return JSON.stringify({ok:true});
    }
    if (args.action === 'submit') {
      if (el.form && el.form.requestSubmit) el.form.requestSubmit();
      else el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));
      return JSON.stringify({ok:true});
    }
    return JSON.stringify({error:'未知操作'});
  } catch (e) {return JSON.stringify({error:String(e && e.message || e)});}
})()
