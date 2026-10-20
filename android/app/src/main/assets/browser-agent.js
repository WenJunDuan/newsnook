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
    var candidates = Array.prototype.filter.call(document.querySelectorAll(selector), visible);
    function priority(el) {
      var rect = el.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= innerHeight && rect.right >= 0 && rect.left <= innerWidth) return 0;
      return Math.max(0, rect.top-innerHeight, -rect.bottom, rect.left-innerWidth, -rect.right);
    }
    // Sort is stable on Android WebView: DOM order is preserved between equally near elements.
    candidates.sort(function(a,b){return priority(a)-priority(b)});
    return candidates.slice(0, cap);
  }
  function visibleText() {
    if (!document.body || !document.createTreeWalker || !document.createRange) return '';
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node, collected = [], count = 0, length = 0;
    while ((node = walker.nextNode()) && count++ < 7500 && length < 11500) {
      var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || !node.parentElement || !visible(node.parentElement)) continue;
      var range = document.createRange();
      range.selectNodeContents(node);
      var rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > innerHeight) continue;
      var item = text.slice(0, 1200);
      collected.push(item);
      length += item.length + 1;
    }
    return collected.join('\n');
  }
  function label(el) {
    if (el.matches('input[type=password],[autocomplete=current-password],[autocomplete=new-password]')) return '[受保护的密码输入框]';
    return (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.getAttribute('title') || '').trim().replace(/\s+/g,' ').slice(0, 120);
  }
  try {
    if (args.action === 'observe') {
      var nodes = elements();
      var snapshot = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
      window.__newsNookAgentSnapshot = {snapshot:snapshot, url:location.href, document:document, nodes:nodes};
      var items = nodes.map(function (el, i) {
        var r = el.getBoundingClientRect();
        return {id:i, tag:el.tagName.toLowerCase(), role:el.getAttribute('role') || '', text:label(el),
          type:el.getAttribute('type') || '', href:el.getAttribute('href') || '',
          x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2),
          options:el.tagName === 'SELECT' ? Array.prototype.map.call(el.options, function(o){return {value:o.value,label:o.text}}).slice(0,20) : undefined};
      });
      var body = (document.body && document.body.innerText || '').replace(/\n{3,}/g,'\n\n');
      var viewportText = visibleText();
      var combined = viewportText ? ('[当前可见内容]\n' + viewportText.slice(0,10500)
          + '\n[页面摘要]\n' + body.slice(0,2500)) : body.slice(0,13000);
      return JSON.stringify({snapshot:snapshot,url:location.href,title:document.title,
        viewport:{width:innerWidth,height:innerHeight}, scrollY:scrollY, documentHeight:document.documentElement.scrollHeight,
        text:combined, elements:items});
    }
    var state = window.__newsNookAgentSnapshot;
    if (!state || !args.snapshot || state.snapshot !== args.snapshot || state.document !== document || state.url !== location.href) {
      return JSON.stringify({error:'页面状态已变化，请重新观察网页'});
    }
    if (args.action === 'scroll') {
      var delta = (args.direction === 'up' ? -1 : 1) * Math.round(innerHeight * .75);
      var scrollers = Array.prototype.filter.call(document.querySelectorAll('*'), function(el) {
        var style = getComputedStyle(el), rect = el.getBoundingClientRect();
        return el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(style.overflowY)
          && rect.width > 0 && rect.height > 80 && rect.bottom > 0 && rect.top < innerHeight;
      });
      scrollers.sort(function(a,b) {
        var ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
        return Math.min(br.height,innerHeight)*br.width-Math.min(ar.height,innerHeight)*ar.width;
      });
      if(scrollers.length) scrollers[0].scrollTop += delta;
      else window.scrollBy({top:delta,behavior:'auto'});
      return JSON.stringify({ok:true});
    }
    var el = state.nodes[args.id];
    if (!el || !el.isConnected || !visible(el)) return JSON.stringify({error:'元素已经失效，请重新观察网页'});
    el.scrollIntoView({block:'center', inline:'nearest'});
    if (args.action === 'click') { el.click(); return JSON.stringify({ok:true}); }
    if (args.action === 'choose') {
      if (el.tagName !== 'SELECT' || el.disabled) return JSON.stringify({error:'目标不是可选下拉框'});
      var value = String(args.text || '');
      var option = Array.prototype.find.call(el.options, function(o){return o.value === value || o.text.trim() === value});
      if (!option) return JSON.stringify({error:'没有匹配的下拉选项'});
      el.value = option.value;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return JSON.stringify({ok:true});
    }
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
