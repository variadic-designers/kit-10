// The single live query whose callback triggers `scheduleReResolve`. PGlite tracks
// table access from the query plan, so a write to any table JOINed here fires the
// callback. The JOIN must cover every table in `RESOLUTION_RELEVANT_TABLES` (exported
// from manager) -- a test asserts that, so adding a resolution-relevant table without
// joining it here is a caught failure rather than silent staleness.
//
// The query deliberately SELECTs only view ids and GROUPs by them: it's a cheap
// trigger, not a rowset carrier. The resolver re-fetches the full rowset via
// `resolveManyViews` on fire. (Phase 1 of the resolver optimization may revisit
// whether this query should carry the rowset instead.)
//
// `kits` is JOINed even though the resolver only reads `kits.name` from it -- a kit
// rename changes no resolution-relevant value but does change `kitName` in the
// output, which the editor displays, so it must still fire a re-resolve.

export const RESOLVE_LIVE_QUERY_SQL = `
	SELECT v.id AS view_id
	FROM views v
	LEFT JOIN compositions c ON c.view_id = v.id
	LEFT JOIN kits k ON k.id = c.kit_id
	LEFT JOIN layers l ON l.kit_id = c.kit_id
	LEFT JOIN layer_axis_values lav ON lav.layer_id = l.id
	LEFT JOIN axis_values axv ON axv.id = lav.axis_value_id
	LEFT JOIN axes_consumed ac ON ac.kit_id = c.kit_id
	LEFT JOIN axis_args aa ON aa.view_id = v.id
	LEFT JOIN render_snippets rs ON rs.layer_id = l.id
	LEFT JOIN render_entries re ON re.snippet_id = rs.id
	LEFT JOIN tokens t ON t.project_id = v.project_id
	WHERE v.project_id = $1
	GROUP BY v.id
`;
