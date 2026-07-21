(function () {
  'use strict';

  var pluginId = 'demo.focus-dot';

  function send(message) {
    window.parent.postMessage(Object.assign({}, message, { pluginId: pluginId }), '*');
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (message && message.type === 'chalkboard:execute' && message.pluginId === pluginId && message.command === 'focusDot.add') {
      window.FocusDotPlugin.add();
      return;
    }
    if (!message || message.type !== 'chalkboard:init' || message.pluginId !== pluginId) return;

    send({ type: 'chalkboard:ready' });
    send({
      type: 'chalkboard:register',
      contributions: {
        tools: [{ id: 'focus-dot.add', label: 'Add Focus Dot', command: 'focusDot.add' }],
        commands: [{ id: 'focusDot.add', title: 'Focus Dot: Add Focus Dot' }]
      }
    });
  });

  // The host owns the board. The plugin requests a command through the bridge.
  window.FocusDotPlugin = {
    add: function () {
      send({
        type: 'chalkboard:command',
        command: 'focusDot.add',
        payload: { source: 'focus-dot' }
      });
    }
  };
}());
