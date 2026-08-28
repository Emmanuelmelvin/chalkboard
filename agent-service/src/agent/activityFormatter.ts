/**
 * @file activityFormatter.ts
 * @description Translates low-level MCP tool names and parameters into human-readable action summaries.
 */

export function formatToolActivity(toolName: string, args: any = {}): { toolAction: string; toolSummary: string } {
  switch (toolName) {
    case 'chalkboard_write_text': {
      const textPreview = typeof args.text === 'string' ? args.text.slice(0, 40) : '';
      return {
        toolAction: 'Writing on chalkboard',
        toolSummary: textPreview ? `Rendering: "${textPreview}${args.text?.length > 40 ? '...' : ''}"` : 'Writing text',
      };
    }
    case 'chalkboard_draw_chalk': {
      const pointCount = Array.isArray(args.points) ? args.points.length : 0;
      return {
        toolAction: 'Drawing chalk stroke',
        toolSummary: `Sketching curve with ${pointCount} points (${args.color || 'white'})`,
      };
    }
    case 'chalkboard_insert_shape': {
      return {
        toolAction: 'Inserting geometric shape',
        toolSummary: `Rendering ${args.type || 'shape'} at (${args.x ?? 0}, ${args.y ?? 0})`,
      };
    }
    case 'chalkboard_create_note': {
      const notePreview = typeof args.text === 'string' ? args.text.slice(0, 30) : '';
      return {
        toolAction: 'Placing sticky note',
        toolSummary: `Card: "${notePreview}"`,
      };
    }
    case 'chalkboard_highlight_area': {
      return {
        toolAction: 'Highlighting board area',
        toolSummary: `Creating ${args.type || 'focus'} highlight (${args.label || 'Emphasis'})`,
      };
    }
    case 'chalkboard_select_and_transform': {
      return {
        toolAction: 'Transforming canvas objects',
        toolSummary: `Action: ${args.action || 'transform'}`,
      };
    }
    case 'chalkboard_navigate_viewport': {
      return {
        toolAction: 'Adjusting classroom viewport',
        toolSummary: `Camera: ${args.action || 'pan'} to (${args.x ?? 0}, ${args.y ?? 0})`,
      };
    }
    case 'chalkboard_send_chat': {
      const msgPreview = typeof args.message === 'string' ? args.message.slice(0, 40) : '';
      return {
        toolAction: 'Sending chat response',
        toolSummary: msgPreview ? `Replying: "${msgPreview}..."` : 'Sending chat response',
      };
    }
    case 'chalkboard_speak_narration': {
      return {
        toolAction: 'Speaking voice narration',
        toolSummary: 'Speaking out loud to classroom',
      };
    }
    case 'chalkboard_load_plugin':
    case 'chalkboard_activate_plugin': {
      return {
        toolAction: 'Loading domain plugin',
        toolSummary: `Activating ${args.pluginId || 'plugin'} tools`,
      };
    }
    case 'chalkboard_discover_plugins': {
      return {
        toolAction: 'Discovering plugins',
        toolSummary: `Searching marketplace for "${args.query || 'all'}"`,
      };
    }
    case 'plugin_math_set_coordinate_grid': {
      return {
        toolAction: 'Drawing Cartesian coordinate grid',
        toolSummary: `Grid x:[${args.xMin ?? -10}..${args.xMax ?? 10}], y:[${args.yMin ?? -10}..${args.yMax ?? 10}]`,
      };
    }
    case 'plugin_math_set_graph': {
      return {
        toolAction: 'Plotting mathematical graph',
        toolSummary: `Function f(x) = ${args.formula || args.function || 'f(x)'}`,
      };
    }
    case 'plugin_math_set_two_set_venn': {
      return {
        toolAction: 'Drawing 2-Set Venn diagram',
        toolSummary: `Sets ${args.setALabel || 'A'} ∩ ${args.setBLabel || 'B'}`,
      };
    }
    case 'plugin_math_set_three_set_venn': {
      return {
        toolAction: 'Drawing 3-Set Venn diagram',
        toolSummary: 'Sets A, B, and C intersections',
      };
    }
    case 'plugin_math_set_number_line': {
      return {
        toolAction: 'Drawing number line',
        toolSummary: `Range [${args.min ?? 0}..${args.max ?? 10}]`,
      };
    }
    case 'plugin_math_set_matrix': {
      return {
        toolAction: 'Rendering math matrix',
        toolSummary: 'Matrix display',
      };
    }
    case 'plugin_statistics_bar_chart': {
      return {
        toolAction: 'Rendering bar chart',
        toolSummary: 'Plotting statistical distribution',
      };
    }
    case 'plugin_statistics_box_plot': {
      return {
        toolAction: 'Rendering box plot',
        toolSummary: 'Five-number summary plot',
      };
    }
    case 'plugin_statistics_summary_table': {
      return {
        toolAction: 'Inserting statistics card',
        toolSummary: 'Summary table metrics',
      };
    }
    default: {
      const cleanName = toolName.replace(/^plugin_/, '').replace(/_/g, ' ');
      return {
        toolAction: `Executing ${cleanName}`,
        toolSummary: `Running ${toolName}`,
      };
    }
  }
}
