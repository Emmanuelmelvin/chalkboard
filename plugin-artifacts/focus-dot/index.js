(function () {
  'use strict';

  var pluginId = 'demo.focus-dot';

  function send(message) {
    window.parent.postMessage(Object.assign({}, message, { pluginId: pluginId }), '*');
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (message && message.type === 'chalkboard:execute' && message.pluginId === pluginId && message.command === 'focusDot.add') {
      window.FocusDotPlugin.add(message.payload);
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
    add: function (executionPayload) {
      var center = executionPayload && executionPayload.context && executionPayload.context.viewportCenter;
      if (!center || typeof center.x !== 'number' || typeof center.y !== 'number') return;
      var radius = 10;
      var points = [];
      for (var index = 0; index < 20; index += 1) {
        var angle = (Math.PI * 2 * index) / 20;
        points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
      }
      send({
        type: 'chalkboard:command',
        command: 'board.insertStrokes',
        payload: {
          strokes: [{
            tool: 'chalk',
            color: '#f6c85f',
            size: 3,
            intensity: 1,
            pathType: 'linear',
            closed: true,
            fillColor: '#f6c85f',
            points: points
          }],
          options: { select: true, closeInsertPanel: true }
        }
      });
    }
  };
}());
