(function () {
  var cardSelect = document.getElementById('card-select');
  var scanBtn = document.getElementById('scan-btn');
  var scanStatus = document.getElementById('scan-status');
  var editorPanel = document.getElementById('editor-panel');
  var cardIdEl = document.getElementById('card-id');
  var cardTitleEl = document.getElementById('card-title');
  var saveBtn = document.getElementById('save-btn');
  var playBtn = document.getElementById('play-btn');
  var stopBtn = document.getElementById('stop-btn');
  var editorStatus = document.getElementById('editor-status');
  var tracksEmpty = document.getElementById('tracks-empty');
  var trackList = document.getElementById('track-list');
  var fileInput = document.getElementById('file-input');

  var currentId = null;
  var tracks = [];
  var missing = [];
  var dirty = false;

  function setStatus(el, text, kind) {
    el.textContent = text || '';
    el.className = kind || 'muted';
    el.hidden = !text;
  }

  function markDirty() {
    dirty = true;
    setStatus(editorStatus, 'Unsaved changes', 'live');
  }

  function clearDirty() {
    dirty = false;
    setStatus(editorStatus, 'Saved', 'muted');
  }

  function optionLabel(card) {
    var label = card.title ? card.title + ' — ' : '';
    return label + card.id;
  }

  function refreshCardList(selectId) {
    return fetch('/api/cards')
      .then(function (res) { return res.json(); })
      .then(function (cards) {
        cardSelect.innerHTML = '<option value="">— choose a card —</option>';
        cards.forEach(function (card) {
          var opt = document.createElement('option');
          opt.value = card.id;
          opt.textContent = optionLabel(card);
          cardSelect.appendChild(opt);
        });
        if (selectId) {
          cardSelect.value = selectId;
        }
      });
  }

  function renderTracks() {
    trackList.innerHTML = '';
    tracksEmpty.hidden = tracks.length > 0;
    tracks.forEach(function (name, index) {
      var li = document.createElement('li');
      li.className = 'track-item';
      if (missing.indexOf(name) >= 0) {
        li.classList.add('missing');
      }
      li.draggable = true;
      li.dataset.index = String(index);

      var nameSpan = document.createElement('span');
      nameSpan.className = 'track-name';
      nameSpan.textContent = name;
      li.appendChild(nameSpan);

      var actions = document.createElement('span');
      actions.className = 'track-actions';

      var upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'icon-btn';
      upBtn.textContent = '↑';
      upBtn.title = 'Move up';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', function () {
        moveTrack(index, index - 1);
      });

      var downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'icon-btn';
      downBtn.textContent = '↓';
      downBtn.title = 'Move down';
      downBtn.disabled = index === tracks.length - 1;
      downBtn.addEventListener('click', function () {
        moveTrack(index, index + 1);
      });

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'icon-btn danger';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove from playlist';
      removeBtn.addEventListener('click', function () {
        tracks.splice(index, 1);
        missing = missing.filter(function (m) { return tracks.indexOf(m) >= 0; });
        markDirty();
        renderTracks();
      });

      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(removeBtn);
      li.appendChild(actions);

      li.addEventListener('dragstart', onDragStart);
      li.addEventListener('dragover', onDragOver);
      li.addEventListener('drop', onDrop);
      li.addEventListener('dragend', onDragEnd);

      trackList.appendChild(li);
    });
  }

  var dragFrom = null;

  function onDragStart(e) {
    dragFrom = Number(e.currentTarget.dataset.index);
    e.currentTarget.classList.add('dragging');
  }

  function onDragOver(e) {
    e.preventDefault();
  }

  function onDrop(e) {
    e.preventDefault();
    var to = Number(e.currentTarget.dataset.index);
    if (dragFrom === null || dragFrom === to) {
      return;
    }
    moveTrack(dragFrom, to);
    dragFrom = null;
  }

  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    dragFrom = null;
  }

  function moveTrack(from, to) {
    if (to < 0 || to >= tracks.length) {
      return;
    }
    var item = tracks.splice(from, 1)[0];
    tracks.splice(to, 0, item);
    markDirty();
    renderTracks();
  }

  function openCard(id) {
    currentId = id;
    return fetch('/api/cards/' + encodeURIComponent(id))
      .then(function (res) {
        if (!res.ok) {
          throw new Error('load failed');
        }
        return res.json();
      })
      .then(function (card) {
        cardIdEl.textContent = card.id;
        cardTitleEl.value = card.title || '';
        tracks = card.tracks.slice();
        missing = card.missing || [];
        dirty = false;
        editorPanel.hidden = false;
        renderTracks();
        setStatus(editorStatus, '', 'muted');
        cardSelect.value = card.id;
      });
  }

  function payload() {
    return {
      title: cardTitleEl.value,
      tracks: tracks,
    };
  }

  function save() {
    if (!currentId) {
      return Promise.resolve();
    }
    saveBtn.disabled = true;
    return fetch('/api/cards/' + encodeURIComponent(currentId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    })
      .then(function (res) {
        if (!res.ok) {
          throw new Error('save failed');
        }
        return res.json();
      })
      .then(function (card) {
        tracks = card.tracks.slice();
        missing = card.missing || [];
        renderTracks();
        clearDirty();
        return refreshCardList(currentId);
      })
      .catch(function () {
        setStatus(editorStatus, 'Save failed', 'dead');
      })
      .finally(function () {
        saveBtn.disabled = false;
      });
  }

  function playCard() {
    if (!currentId) {
      return;
    }
    if (dirty) {
      setStatus(editorStatus, 'Save first — play uses the saved playlist only', 'dead');
      return;
    }
    fetch('/api/cards/' + encodeURIComponent(currentId) + '/play', {
      method: 'POST',
    })
      .then(function (res) {
        if (!res.ok && res.status !== 204) {
          throw new Error('play failed');
        }
        setStatus(editorStatus, 'Playing…', 'live');
      })
      .catch(function () {
        setStatus(editorStatus, 'Play failed', 'dead');
      });
  }

  cardSelect.addEventListener('change', function () {
    var id = cardSelect.value;
    if (!id) {
      editorPanel.hidden = true;
      currentId = null;
      return;
    }
    openCard(id).catch(function () {
      setStatus(editorStatus, 'Could not load card', 'dead');
    });
  });

  scanBtn.addEventListener('click', function () {
    scanBtn.disabled = true;
    setStatus(scanStatus, 'Waiting for tap…', 'live');
    fetch('/wait-tap')
      .then(function (res) {
        if (res.status === 408) {
          setStatus(scanStatus, 'Timed out', 'dead');
          return null;
        }
        if (!res.ok) {
          setStatus(scanStatus, 'Request failed', 'dead');
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) {
          return;
        }
        setStatus(scanStatus, 'Tap received', 'muted');
        return refreshCardList(data.id).then(function () {
          return openCard(data.id);
        });
      })
      .catch(function () {
        setStatus(scanStatus, 'Network error', 'dead');
      })
      .finally(function () {
        scanBtn.disabled = false;
      });
  });

  cardTitleEl.addEventListener('input', markDirty);

  saveBtn.addEventListener('click', save);
  playBtn.addEventListener('click', playCard);

  stopBtn.addEventListener('click', function () {
    fetch('/api/stop', { method: 'POST' })
      .then(function () {
        setStatus(editorStatus, 'Stopped', 'muted');
      })
      .catch(function () {
        setStatus(editorStatus, 'Stop failed', 'dead');
      });
  });

  fileInput.addEventListener('change', function () {
    if (!currentId || !fileInput.files.length) {
      return;
    }
    var form = new FormData();
    for (var i = 0; i < fileInput.files.length; i++) {
      form.append('file', fileInput.files[i]);
    }
    setStatus(editorStatus, 'Uploading…', 'live');
    fetch('/api/cards/' + encodeURIComponent(currentId) + '/tracks', {
      method: 'POST',
      body: form,
    })
      .then(function (res) {
        if (!res.ok) {
          throw new Error('upload failed');
        }
        return res.json();
      })
      .then(function (data) {
        data.uploaded.forEach(function (name) {
          if (tracks.indexOf(name) < 0) {
            tracks.push(name);
          }
        });
        renderTracks();
        fileInput.value = '';
        return save();
      })
      .then(function () {
        setStatus(editorStatus, 'Files added', 'muted');
      })
      .catch(function () {
        setStatus(editorStatus, 'Upload failed', 'dead');
        fileInput.value = '';
      });
  });

  refreshCardList();
})();
