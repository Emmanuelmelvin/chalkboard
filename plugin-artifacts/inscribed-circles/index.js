(function () {
  'use strict';

  var pluginId = 'demo.inscribed-circles';

  function send(message) {
    window.parent.postMessage(Object.assign({}, message, { pluginId: pluginId }), '*');
  }

  function circlePoints(center, radius) {
    var points = [];
    var segments = 40;
    for (var index = 0; index < segments; index += 1) {
      var angle = (Math.PI * 2 * index) / segments;
      points.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      });
    }
    return points;
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (message && message.type === 'chalkboard:execute' && message.pluginId === pluginId && message.command === 'inscribedCircles.add') {
      window.InscribedCirclesPlugin.add(message.payload);
      return;
    }
    if (!message || message.type !== 'chalkboard:init' || message.pluginId !== pluginId) return;

    send({ type: 'chalkboard:ready' });
    send({
      type: 'chalkboard:register',
      contributions: {
        tools: [{ id: 'inscribed-circles.add', label: 'Add Inscribed Circles', command: 'inscribedCircles.add' }],
        commands: [{ id: 'inscribedCircles.add', title: 'Inscribed Circles: Add Circles' }]
      }
    });
  });

  window.InscribedCirclesPlugin = {
    add: function (executionPayload) {
      var center = executionPayload && executionPayload.context && executionPayload.context.viewportCenter;
      if (!center || typeof center.x !== 'number' || typeof center.y !== 'number') return;

      var outerRadius = 90;
      var innerRadius = 45;
      send({
        type: 'chalkboard:command',
        command: 'board.insertStrokes',
        payload: {
          strokes: [
            {
              tool: 'chalk',
              color: '#2f4858',
              size: 4,
              intensity: 1,
              pathType: 'linear',
              closed: true,
              points: circlePoints(center, outerRadius)
            },
            {
              tool: 'chalk',
              color: '#f6c85f',
              size: 4,
              intensity: 1,
              pathType: 'linear',
              closed: true,
              points: circlePoints(center, innerRadius)
            }
          ],
          options: { select: true, group: true }
        }
      });
    }
  };
}());
