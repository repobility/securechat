/**
 * SecureChat front-end.
 *
 * Responsibilities:
 *   - Manage the local wallet (X25519 keypair) in localStorage.
 *   - Maintain a contact book (pubkey -> name).
 *   - Encrypt outgoing messages and decrypt incoming ones in the browser.
 *   - Render the UI: setup screen, sidebar, chat thread, modals, toasts.
 *
 * The relay server only sees ciphertext + pubkey routing metadata.
 */
(function () {
  'use strict';

  // ---------- Storage keys ----------

  const LS_WALLET = 'sc:wallet:v1';
  const LS_CONTACTS = 'sc:contacts:v1';
  const LS_THREADS = 'sc:threads:v1';

  // ---------- App state ----------

  const state = {
    wallet: null, // { publicKey, secretKey, name }
    contacts: [], // [{ pubKey, name, online, unread }]
    threads: {}, // pubKey -> [{ id, dir, text, ts, status }]
    activePeer: null, // pubKey of selected contact
    socket: null,
    typingTimers: {}, // pubKey -> timeout id
    peerTypingTimers: {}, // pubKey -> timeout id
  };

  // ---------- DOM refs ----------

  const $ = (sel, root = document) => root.querySelector(sel);

  const els = {
    setupScreen: $('#setup-screen'),
    appScreen: $('#app-screen'),
    btnCreate: $('#btn-create-wallet'),
    btnImport: $('#btn-import-wallet'),
    importPane: $('#import-pane'),
    createPane: $('#create-pane'),
    importKey: $('#import-key'),
    importName: $('#import-name'),
    btnDoImport: $('#btn-do-import'),
    importError: $('#import-error'),
    createName: $('#create-name'),

    selfName: $('#self-name'),
    selfPubKey: $('#self-pubkey-short'),
    btnCopyPubkey: $('#btn-copy-pubkey'),
    selfStatus: $('#self-status'),
    btnShowSecret: $('#btn-show-secret'),
    btnRename: $('#btn-rename'),
    btnMenu: $('#btn-menu'),

    btnAddContact: $('#btn-add-contact'),
    contactList: $('#contact-list'),

    chatHeader: $('#chat-header'),
    chatTitle: $('#chat-title'),
    chatPubKey: $('#chat-pubkey'),
    btnCopyPeer: $('#btn-copy-peer'),
    peerStatus: $('#peer-status'),
    btnClearThread: $('#btn-clear-thread'),
    btnRemoveContact: $('#btn-remove-contact'),

    messages: $('#messages'),
    emptyChat: $('#empty-chat'),
    composer: $('#composer'),
    composerForm: $('#composer-form'),
    composerInput: $('#composer-input'),
    composerRecipient: $('#composer-recipient'),
    typingIndicator: $('#typing-indicator'),

    modalBackdrop: $('#modal-backdrop'),
    modalTitle: $('#modal-title'),
    modalBody: $('#modal-body'),
    modalClose: $('#modal-close'),

    toast: $('#toast'),
  };

  // ---------- Random IDs ----------

  /**
   * CSPRNG-backed unique ID generator for messages and other UI elements.
   * Uses crypto.getRandomValues so the whole module stays on one consistent
   * randomness story (the file also handles wallet keys).
   *
   * @param {number} [byteLength=6]
   * @returns {string} Hex-encoded random bytes.
   */
  function randomId(byteLength = 6) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return hex;
  }

  // ---------- Storage helpers ----------

  function loadWallet() {
    try {
      const raw = localStorage.getItem(LS_WALLET);
      if (!raw) return null;
      const w = JSON.parse(raw);
      if (!w || !w.publicKey || !w.secretKey) return null;
      return w;
    } catch (_) {
      return null;
    }
  }
  function saveWallet(w) {
    localStorage.setItem(LS_WALLET, JSON.stringify(w));
  }

  function loadContacts() {
    try {
      const raw = localStorage.getItem(LS_CONTACTS);
      if (!raw) return [];
      const c = JSON.parse(raw);
      return Array.isArray(c) ? c : [];
    } catch (_) {
      return [];
    }
  }
  function saveContacts() {
    localStorage.setItem(LS_CONTACTS, JSON.stringify(state.contacts));
  }

  function loadThreads() {
    try {
      const raw = localStorage.getItem(LS_THREADS);
      if (!raw) return {};
      const t = JSON.parse(raw);
      return t && typeof t === 'object' ? t : {};
    } catch (_) {
      return {};
    }
  }
  function saveThreads() {
    localStorage.setItem(LS_THREADS, JSON.stringify(state.threads));
  }

  // ---------- Tiny UI utilities ----------

  let toastTimer = null;
  function toast(message, ms = 2200) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, ms);
  }

  function openModal(title, contentNode) {
    els.modalTitle.textContent = title;
    els.modalBody.replaceChildren(contentNode);
    els.modalBackdrop.hidden = false;
  }
  function closeModal() {
    els.modalBackdrop.hidden = true;
    els.modalBody.replaceChildren();
  }
  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === els.modalBackdrop) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modalBackdrop.hidden) closeModal();
  });

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch (_) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast('Copied');
      } catch (_) {
        toast('Copy failed');
      }
      ta.remove();
    }
  }

  // ---------- Wallet setup flow ----------

  function showSetup() {
    els.setupScreen.hidden = false;
    els.appScreen.hidden = true;
  }
  function showApp() {
    els.setupScreen.hidden = true;
    els.appScreen.hidden = false;
  }

  els.btnCreate.addEventListener('click', () => {
    const name = (els.createName.value || '').trim().slice(0, 40);
    const kp = SC_Crypto.generateWallet();
    const wallet = { publicKey: kp.publicKey, secretKey: kp.secretKey, name };
    saveWallet(wallet);
    state.wallet = wallet;
    bootApp();
    setTimeout(() => showSecretKeyBackup(true), 300);
  });

  els.btnImport.addEventListener('click', () => {
    els.importPane.open = true;
    els.importKey.focus();
  });

  els.btnDoImport.addEventListener('click', () => {
    els.importError.hidden = true;
    const sk = (els.importKey.value || '').trim();
    if (!sk) {
      els.importError.textContent = 'Please paste a secret key.';
      els.importError.hidden = false;
      return;
    }
    try {
      const kp = SC_Crypto.walletFromSecretKey(sk);
      const name = (els.importName.value || '').trim().slice(0, 40);
      const wallet = { publicKey: kp.publicKey, secretKey: kp.secretKey, name };
      saveWallet(wallet);
      state.wallet = wallet;
      bootApp();
    } catch (err) {
      els.importError.textContent = err.message || 'Invalid secret key.';
      els.importError.hidden = false;
    }
  });

  // ---------- Identity rendering ----------

  function renderIdentity() {
    const w = state.wallet;
    els.selfName.textContent = w.name || 'Anonymous';
    els.selfPubKey.textContent = SC_Crypto.fingerprint(w.publicKey);
    els.selfPubKey.setAttribute('title', w.publicKey);
  }

  els.btnCopyPubkey.addEventListener('click', () => copyToClipboard(state.wallet.publicKey));

  els.btnRename.addEventListener('click', () => {
    const input = el('input', { type: 'text', maxlength: '40', value: state.wallet.name || '' });
    const save = el('button', {
      class: 'primary',
      text: 'Save',
      onclick: () => {
        state.wallet.name = (input.value || '').trim().slice(0, 40);
        saveWallet(state.wallet);
        renderIdentity();
        closeModal();
      },
    });
    const cancel = el('button', { class: 'ghost', text: 'Cancel', onclick: closeModal });
    const body = el('div', {}, [
      el('label', { text: 'Display name (local only — not sent to anyone unless you tell them)' }),
      input,
      el('div', { class: 'actions' }, [cancel, save]),
    ]);
    openModal('Rename wallet', body);
    setTimeout(() => input.focus(), 50);
  });

  function showSecretKeyBackup(isFirstTime = false) {
    const warning = el('div', {
      class: 'warning',
      text: 'Your secret key IS your identity. Anyone who has it can impersonate you and read all messages sent to you. Store it somewhere safe (a password manager) and never share it.',
    });
    const ta = el('textarea', { rows: '3', readonly: 'true' });
    ta.value = state.wallet.secretKey;
    const copy = el('button', {
      class: 'ghost',
      text: 'Copy secret key',
      onclick: () => copyToClipboard(state.wallet.secretKey),
    });
    const close = el('button', {
      class: 'primary',
      text: isFirstTime ? "I've saved it" : 'Close',
      onclick: closeModal,
    });
    const body = el('div', {}, [
      warning,
      el('label', { text: 'Secret key (base64, 32 bytes)' }),
      ta,
      el('div', { class: 'actions' }, [copy, close]),
    ]);
    openModal(isFirstTime ? 'Back up your wallet' : 'Wallet secret key', body);
  }
  els.btnShowSecret.addEventListener('click', () => showSecretKeyBackup(false));

  els.btnMenu.addEventListener('click', () => {
    const showPub = el('button', {
      class: 'ghost',
      text: 'Show full public key',
      onclick: () => {
        const ta = el('textarea', { rows: '2', readonly: 'true' });
        ta.value = state.wallet.publicKey;
        const copy = el('button', {
          class: 'ghost',
          text: 'Copy',
          onclick: () => copyToClipboard(state.wallet.publicKey),
        });
        const close = el('button', { class: 'primary', text: 'Close', onclick: closeModal });
        const body = el('div', {}, [
          el('p', {
            class: 'muted',
            text: 'Share this with people you want to chat with. It is safe to share.',
          }),
          ta,
          el('div', { class: 'actions' }, [copy, close]),
        ]);
        openModal('Your public key', body);
      },
    });
    const showSec = el('button', {
      class: 'ghost',
      text: 'Show secret key (sensitive)',
      onclick: () => {
        closeModal();
        showSecretKeyBackup(false);
      },
    });
    const logout = el('button', {
      class: 'ghost danger',
      text: 'Log out / wipe this device',
      onclick: () => {
        closeModal();
        confirmDialog(
          'Wipe wallet from this device?',
          'This deletes your wallet, contacts, and message history from this browser. If you have not backed up your secret key, your identity will be lost forever and messages sent to you will be undecryptable.',
          'Wipe everything',
          () => {
            localStorage.removeItem(LS_WALLET);
            localStorage.removeItem(LS_CONTACTS);
            localStorage.removeItem(LS_THREADS);
            location.reload();
          },
        );
      },
    });
    const close = el('button', { class: 'ghost', text: 'Close', onclick: closeModal });
    const body = el('div', {}, [
      el('p', { class: 'muted', text: 'Your wallet & contacts are stored only in this browser.' }),
      showPub,
      el('div', { style: 'height:8px' }),
      showSec,
      el('div', { style: 'height:8px' }),
      logout,
      el('div', { class: 'actions' }, [close]),
    ]);
    openModal('Account', body);
  });

  function confirmDialog(title, message, confirmLabel, onConfirm) {
    const cancel = el('button', { class: 'ghost', text: 'Cancel', onclick: closeModal });
    const ok = el('button', {
      class: 'primary',
      text: confirmLabel,
      onclick: () => {
        closeModal();
        onConfirm();
      },
    });
    const body = el('div', {}, [
      el('p', { class: 'muted', text: message }),
      el('div', { class: 'actions' }, [cancel, ok]),
    ]);
    openModal(title, body);
  }

  // ---------- Contacts ----------

  function findContact(pubKey) {
    return state.contacts.find((c) => c.pubKey === pubKey) || null;
  }

  function ensureContact(pubKey, fallbackName) {
    let c = findContact(pubKey);
    if (!c) {
      c = { pubKey, name: fallbackName || '', online: false, unread: 0 };
      state.contacts.push(c);
      saveContacts();
    }
    return c;
  }

  function renderContacts() {
    els.contactList.replaceChildren();
    if (state.contacts.length === 0) {
      els.contactList.appendChild(
        el('li', {
          class: 'empty-list',
          text: 'No contacts yet. Tap ＋ to add one with their public key.',
        }),
      );
      return;
    }
    // Sort: contact with unread first, then by name/fingerprint
    const sorted = [...state.contacts].sort((a, b) => {
      if ((b.unread || 0) - (a.unread || 0)) return (b.unread || 0) - (a.unread || 0);
      const an = (a.name || a.pubKey).toLowerCase();
      const bn = (b.name || b.pubKey).toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    for (const c of sorted) {
      const av = SC_Crypto.avatarFor(c.pubKey);
      const avatar = el('div', {
        class: 'contact-avatar',
        style: `background:${av.bg}`,
        text: av.initials,
      });
      const meta = el('div', { class: 'contact-meta' }, [
        el('div', { class: 'contact-name', text: c.name || 'Unnamed' }),
        el('div', { class: 'contact-pubkey', text: SC_Crypto.fingerprint(c.pubKey) }),
      ]);
      const right = el('div', { class: 'contact-right' }, [
        el('span', {
          class: 'dot ' + (c.online ? 'online' : 'offline'),
          title: c.online ? 'online' : 'offline',
        }),
        c.unread ? el('span', { class: 'contact-unread', text: String(c.unread) }) : null,
      ]);
      const li = el(
        'li',
        {
          class: 'contact' + (state.activePeer === c.pubKey ? ' active' : ''),
          onclick: () => selectContact(c.pubKey),
        },
        [avatar, meta, right],
      );
      els.contactList.appendChild(li);
    }
  }

  els.btnAddContact.addEventListener('click', () => {
    const pkInput = el('textarea', {
      rows: '3',
      placeholder: 'Paste their public key (44 base64 chars ending in =)',
    });
    const nameInput = el('input', { type: 'text', maxlength: '40', placeholder: 'e.g. Alice' });
    const error = el('p', { class: 'error', hidden: 'true' });
    const cancel = el('button', { class: 'ghost', text: 'Cancel', onclick: closeModal });
    const add = el('button', {
      class: 'primary',
      text: 'Add contact',
      onclick: () => {
        const pk = (pkInput.value || '').trim();
        if (!SC_Crypto.isValidPublicKey(pk)) {
          error.textContent = "That doesn't look like a valid public key.";
          error.hidden = false;
          return;
        }
        if (pk === state.wallet.publicKey) {
          error.textContent = 'That is your own public key.';
          error.hidden = false;
          return;
        }
        if (findContact(pk)) {
          error.textContent = 'That contact is already in your list.';
          error.hidden = false;
          return;
        }
        const name = (nameInput.value || '').trim().slice(0, 40);
        ensureContact(pk, name);
        checkPresence(pk);
        renderContacts();
        selectContact(pk);
        closeModal();
      },
    });
    const body = el('div', {}, [
      el('label', { text: 'Public key' }),
      pkInput,
      el('label', { text: 'Display name (optional, local only)' }),
      nameInput,
      error,
      el('div', { class: 'actions' }, [cancel, add]),
    ]);
    openModal('Add contact', body);
    setTimeout(() => pkInput.focus(), 50);
  });

  // ---------- Chat thread rendering ----------

  function selectContact(pubKey) {
    state.activePeer = pubKey;
    const c = findContact(pubKey);
    if (c && c.unread) {
      c.unread = 0;
      saveContacts();
    }
    renderContacts();
    renderChat();
    checkPresence(pubKey);
    setTimeout(() => els.composerInput && els.composerInput.focus(), 50);
  }

  function getThread(pubKey) {
    if (!state.threads[pubKey]) state.threads[pubKey] = [];
    return state.threads[pubKey];
  }

  function appendMessage(pubKey, msg) {
    const thread = getThread(pubKey);
    thread.push(msg);
    saveThreads();
    if (state.activePeer === pubKey) renderChat();
  }

  function updateMessageStatus(pubKey, id, patch) {
    const thread = getThread(pubKey);
    const m = thread.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    saveThreads();
    if (state.activePeer === pubKey) renderChat();
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  function fmtDay(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yest = new Date();
    yest.setDate(today.getDate() - 1);
    const sameDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yest)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function renderChat() {
    if (!state.activePeer) {
      els.chatHeader.hidden = true;
      els.composer.hidden = true;
      els.messages.replaceChildren(els.emptyChat);
      els.emptyChat.hidden = false;
      return;
    }
    const c = findContact(state.activePeer);
    if (!c) return;

    els.chatHeader.hidden = false;
    els.composer.hidden = false;
    els.emptyChat.hidden = true;

    els.chatTitle.textContent = c.name || 'Unnamed contact';
    els.chatPubKey.textContent = SC_Crypto.fingerprint(c.pubKey);
    els.chatPubKey.setAttribute('title', c.pubKey);
    els.peerStatus.className = 'dot ' + (c.online ? 'online' : 'offline');
    els.peerStatus.setAttribute('title', c.online ? 'online' : 'offline');
    els.composerRecipient.textContent = SC_Crypto.fingerprint(c.pubKey);

    const thread = getThread(c.pubKey);
    els.messages.replaceChildren();

    let lastDay = '';
    for (const m of thread) {
      const day = fmtDay(m.ts);
      if (day !== lastDay) {
        els.messages.appendChild(el('div', { class: 'day-divider', text: day }));
        lastDay = day;
      }
      els.messages.appendChild(renderBubble(m));
    }
    requestAnimationFrame(() => {
      els.messages.scrollTop = els.messages.scrollHeight;
    });
  }

  function renderBubble(m) {
    if (m.kind === 'system') {
      return el('div', { class: 'message-row peer' }, [
        el('div', { class: 'bubble system', text: m.text }),
      ]);
    }
    const dirClass = m.dir === 'out' ? 'self' : 'peer';
    const bubbleClass = 'bubble' + (m.kind === 'error' ? ' error' : '');
    const meta = el('div', { class: 'bubble-meta' }, [fmtTime(m.ts)]);
    if (m.dir === 'out') {
      const status = el('span', { class: 'bubble-status ' + (m.status || '') });
      status.textContent =
        m.status === 'sending'
          ? ' · sending…'
          : m.status === 'queued'
            ? ' · queued (offline)'
            : m.status === 'delivered'
              ? ' · delivered'
              : m.status === 'failed'
                ? ' · failed'
                : '';
      meta.appendChild(status);
    }
    return el('div', { class: 'message-row ' + dirClass }, [
      el('div', {}, [el('div', { class: bubbleClass, text: m.text }), meta]),
    ]);
  }

  // ---------- Composer ----------

  els.composerInput.addEventListener('input', () => {
    autosize(els.composerInput);
    sendTypingPing();
  });
  els.composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      els.composerForm.requestSubmit();
    }
  });
  els.composerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }

  function sendTypingPing() {
    if (!state.activePeer || !state.socket) return;
    const peer = state.activePeer;
    state.socket.emit('typing', { to: peer, typing: true });
    if (state.typingTimers[peer]) clearTimeout(state.typingTimers[peer]);
    state.typingTimers[peer] = setTimeout(() => {
      if (state.socket) state.socket.emit('typing', { to: peer, typing: false });
    }, 1500);
  }

  function sendMessage() {
    const peer = state.activePeer;
    if (!peer) return;
    const text = els.composerInput.value;
    if (!text || !text.trim()) return;
    if (text.length > SC_Crypto.MAX_PLAINTEXT_BYTES) {
      toast('Message too long.');
      return;
    }
    let envelope;
    try {
      envelope = SC_Crypto.encryptMessage(text, peer, state.wallet.secretKey);
    } catch (err) {
      toast('Encryption failed: ' + err.message);
      return;
    }

    const id = 'm_' + Date.now() + '_' + randomId(6);
    appendMessage(peer, { id, dir: 'out', text, ts: Date.now(), status: 'sending' });
    els.composerInput.value = '';
    autosize(els.composerInput);

    if (!state.socket || state.socket.disconnected) {
      updateMessageStatus(peer, id, { status: 'failed' });
      toast('Not connected. Message will not be sent.');
      return;
    }

    state.socket.emit(
      'message',
      { to: peer, nonce: envelope.nonce, ciphertext: envelope.ciphertext },
      (ack) => {
        if (!ack || !ack.ok) {
          updateMessageStatus(peer, id, { status: 'failed' });
          return;
        }
        if (ack.delivered)
          updateMessageStatus(peer, id, { status: 'delivered', ts: ack.ts || Date.now() });
        else if (ack.queued)
          updateMessageStatus(peer, id, { status: 'queued', ts: ack.ts || Date.now() });
      },
    );

    if (state.typingTimers[peer]) clearTimeout(state.typingTimers[peer]);
    state.socket.emit('typing', { to: peer, typing: false });
  }

  // ---------- Chat header actions ----------

  els.btnCopyPeer.addEventListener('click', () => {
    if (state.activePeer) copyToClipboard(state.activePeer);
  });

  els.btnClearThread.addEventListener('click', () => {
    if (!state.activePeer) return;
    confirmDialog(
      'Clear thread?',
      'This deletes the local copy of your messages with this contact. Other devices and the contact still have their own copies.',
      'Clear',
      () => {
        state.threads[state.activePeer] = [];
        saveThreads();
        renderChat();
      },
    );
  });

  els.btnRemoveContact.addEventListener('click', () => {
    if (!state.activePeer) return;
    const peer = state.activePeer;
    confirmDialog(
      'Remove contact?',
      'This removes the contact and the local message history with them. They can still send you messages, and you can re-add them later.',
      'Remove',
      () => {
        state.contacts = state.contacts.filter((c) => c.pubKey !== peer);
        delete state.threads[peer];
        state.activePeer = null;
        saveContacts();
        saveThreads();
        renderContacts();
        renderChat();
      },
    );
  });

  // ---------- Networking ----------

  function connect() {
    const socket = io({ transports: ['websocket', 'polling'] });
    state.socket = socket;

    socket.on('connect', () => {
      els.selfStatus.classList.add('online');
      els.selfStatus.classList.remove('offline');
      els.selfStatus.setAttribute('title', 'Connected to relay');
      socket.emit('register', { pubKey: state.wallet.publicKey }, (ack) => {
        if (!ack || !ack.ok) {
          toast('Failed to register with relay.');
          return;
        }
        // Re-check presence for known contacts after reconnect
        for (const c of state.contacts) checkPresence(c.pubKey);
      });
    });

    socket.on('disconnect', () => {
      els.selfStatus.classList.remove('online');
      els.selfStatus.classList.add('offline');
      els.selfStatus.setAttribute('title', 'Disconnected');
      // Mark all contacts offline locally; presence:check on reconnect will refresh
      for (const c of state.contacts) c.online = false;
      renderContacts();
      if (state.activePeer) renderChat();
    });

    socket.on('connect_error', () => {
      els.selfStatus.classList.remove('online');
      els.selfStatus.classList.add('offline');
    });

    socket.on('message', (env) => {
      handleIncoming(env);
    });

    socket.on('presence', ({ pubKey, online }) => {
      const c = findContact(pubKey);
      if (!c) return;
      c.online = !!online;
      saveContacts();
      renderContacts();
      if (state.activePeer === pubKey) renderChat();
    });

    socket.on('typing', ({ from, typing }) => {
      if (state.activePeer !== from) return;
      els.typingIndicator.hidden = !typing;
      if (typing) {
        if (state.peerTypingTimers[from]) clearTimeout(state.peerTypingTimers[from]);
        state.peerTypingTimers[from] = setTimeout(() => {
          els.typingIndicator.hidden = true;
        }, 4000);
      }
    });
  }

  function checkPresence(pubKey) {
    if (!state.socket || state.socket.disconnected) return;
    state.socket.emit('presence:check', { pubKey }, (ack) => {
      if (!ack || !ack.ok) return;
      const c = findContact(pubKey);
      if (!c) return;
      c.online = !!ack.online;
      saveContacts();
      renderContacts();
      if (state.activePeer === pubKey) renderChat();
    });
  }

  function handleIncoming(env) {
    if (!env || !env.from || !env.nonce || !env.ciphertext) return;
    const decoded = SC_Crypto.decryptMessage(
      env.ciphertext,
      env.nonce,
      env.from,
      state.wallet.secretKey,
    );
    if (!decoded) {
      // Could not decrypt — wrong recipient, tampered, or unknown sender format.
      // We surface this inline only if we already know the sender; otherwise drop silently.
      const c = findContact(env.from);
      if (c) {
        appendMessage(env.from, {
          id: 'err_' + (env.ts || Date.now()),
          kind: 'error',
          dir: 'in',
          text: '⚠ Could not decrypt a message from this contact (tampered or wrong key).',
          ts: env.ts || Date.now(),
        });
      }
      return;
    }

    const c = ensureContact(env.from, '');
    const id = 'm_' + (env.ts || Date.now()) + '_' + randomId(6);
    appendMessage(env.from, {
      id,
      dir: 'in',
      text: decoded.text,
      ts: env.ts || decoded.ts || Date.now(),
      status: 'delivered',
    });

    if (state.activePeer !== env.from) {
      c.unread = (c.unread || 0) + 1;
      saveContacts();
      renderContacts();
      maybeNotify(c, decoded.text);
    }
  }

  function maybeNotify(contact, text) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      const title = contact.name || SC_Crypto.fingerprint(contact.pubKey);
      const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
      new Notification('SecureChat — ' + title, { body: preview, silent: false });
    } catch (_) {
      /* ignore */
    }
  }

  // ---------- Boot ----------

  function bootApp() {
    state.contacts = loadContacts();
    state.threads = loadThreads();
    state.activePeer = null;

    renderIdentity();
    renderContacts();
    renderChat();
    showApp();

    if ('Notification' in window && Notification.permission === 'default') {
      // Best-effort: ask once. Browsers ignore non-user-gestured calls; this is fine.
      try {
        Notification.requestPermission();
      } catch (_) {
        /* ignore */
      }
    }

    connect();
  }

  function start() {
    const wallet = loadWallet();
    if (wallet) {
      state.wallet = wallet;
      bootApp();
    } else {
      showSetup();
    }
  }

  start();
})();
