<script lang="ts" module>
	export type TokenValueKind = 'string' | 'number' | 'range' | TokenValueKind[];

	export type TokenValueBare = {
		kind: 'raw';
		value: string;
	};

	export type TokenValueResolveSimple = {
		kind: 'simple';
		resolve: string;
	};

	export type TokenValueResolveFormat = {
		kind: 'format';
		fmt?: (number | string)[];
		resolve: string[];
	};

	export type TokenIdent = {
		name: string;
		displayName: string;
	};

	export interface Token extends TokenIdent {
		value: TokenValueBare | TokenValueResolveSimple | TokenValueResolveFormat;
		semantic?: false;
		description?: string;
		type?: string;
	}

	export type TokenPanelProps = {
		tokens: Token[];
		tokenLibraries: { [namespace: string]: TokenLibraryNode };
	};

	export type TokenLibraryNode = {
		displayName?: string;
		description?: string;
		name: string;
		tokens?: Token[];
		children?: { [namespace: string]: TokenLibraryNode };
	};
</script>

<script lang="ts">
	import { contextMenu, type ContextMenuContentGenerator } from '$lib/components/contextMenu.js';
	import Renameable from '$lib/components/Renameable.svelte';
	import Panel from '../Panel.svelte';
	import { type Api, type EditorState, type TokenValue, resolveLinkedArg } from 'manager';
	import { liveQuery, type EditorActivity } from '../Editor.svelte';
	import { tokenIcon, isColorValue, tokenStr } from './token-utils.ts';
	import { draggable, dropZone, type DragPayload } from '../dnd.svelte.ts';

	type TokenRow = {
		tokenId: string;
		tokenAlias: string | null;
		tokenValue: TokenValue | null;
		tokenKitId: string | null;
		tokenViewId: string | null;
	};

	type TokensPanelProps = {
		api: Api;
		editorReady: EditorState;
		editorActivity: EditorActivity;
	};

	let { api, editorReady, editorActivity = $bindable() }: TokensPanelProps = $props();

	const projectTokensQuery = liveQuery((api, activity) => {
		return api.getTokensByProjectId(activity.activeProjectId);
	});

	const kitTokensQuery = liveQuery((api, activity) => {
		return api.getTokensByKitId(activity.activeKitId);
	});

	const viewTokensQuery = liveQuery((api, activity) => {
		return api.getTokensByViewId(activity.activeViewId);
	});

	const activeViewQuery = liveQuery((api, activity) => {
		return api.getViewsByProjectId(activity.activeProjectId);
	});

	const activeKitQuery = liveQuery((api, activity) => {
		return api.getKitCompositionByViewId(activity.activeViewId);
	});

	// The active (view, kit) pair's OWN current axis picks -- what the Axes panel would show as
	// "selected" right now for this view/kit. Backs the kit-level drag chips below: dragging one
	// onto a `view`-typed token means "make this child match what I (the parent) currently am,"
	// not "pick some arbitrary value from the axis's full list". The all-zero id is a no-selection
	// sentinel (nothing active yet), matching the null-guard convention other getXByY queries use.
	const activeAxisArgsQuery = liveQuery((api, activity) => {
		return api.getAllAxisArgs(
			activity.activeViewId ?? '00000000-0000-0000-0000-000000000000',
			activity.activeKitId ?? '00000000-0000-0000-0000-000000000000'
		);
	});

	// Project-wide, genuinely LIVE (real PGlite live query, not a one-shot cache) -- backs the
	// "Add Axis" cascade on a `view`-typed token. Project-wide rather than scoped to one target
	// view id specifically so it can be a live query at all: a per-view-id Promise-based fetch
	// (the original approach) has no way to notice a kit gaining a newly-consumed axis, or a view
	// composing a new kit, after that one-shot fetch already ran -- "Add Axis" would then stay
	// disabled for the rest of the session even after adding the missing layers/axis. Grouped
	// client-side by viewId (then by kitId) in tokenContextMenu below.
	const axesConsumedQuery = liveQuery((api, activity) => {
		return api.getAxesConsumedByProjectId(activity.activeProjectId);
	});

	// Same live-query reasoning as axesConsumedQuery -- every axis value in the project, filtered
	// to pick-able (literal/discrete) ones and grouped by axisId in tokenContextMenu.
	const axisValuesQuery = liveQuery((api, activity) => {
		return api.getAxisValuesByProjectId(activity.activeProjectId);
	});

	const axesByViewId = $derived.by(() => {
		const map = new Map<string, { axisId: string; axisName: string | null; kitId: string; kitName: string | null }[]>();
		for (const a of axesConsumedQuery.rows) {
			const arr = map.get(a.viewId) ?? [];
			arr.push(a);
			map.set(a.viewId, arr);
		}
		return map;
	});

	const axisValuesByAxisId = $derived.by(() => {
		const map = new Map<string, { axisValueId: string; value: any }[]>();
		for (const v of axisValuesQuery.rows) {
			if (v.value?.type !== 'literal' && v.value?.type !== 'discrete') continue;
			const arr = map.get(v.axisId) ?? [];
			arr.push(v);
			map.set(v.axisId, arr);
		}
		return map;
	});

	// Project-wide, live -- backs a `linked` override chip's DISPLAY, whose source (view, kit) may
	// not be whatever's currently active (that's exactly why a linked override is useful: it can
	// point anywhere in the project). Same live-query reasoning as axesConsumedQuery/axisValuesQuery.
	const allAxisArgsQuery = liveQuery((api, activity) => {
		return api.getAxisArgsByProjectId(activity.activeProjectId);
	});

	// Shaped for resolveLinkedArg (keyed `${viewId}::${kitId}`, each a Record<axisId, ArgValue>) --
	// project-wide so a chain can be walked regardless of which view/kit its links pass through.
	const argsByViewKitAll = $derived.by(() => {
		const map = new Map<string, Record<string, any>>();
		for (const a of allAxisArgsQuery.rows) {
			const key = `${a.viewId}::${a.kitId}`;
			if (!map.has(key)) map.set(key, {});
			map.get(key)![a.axisId] = a.value;
		}
		return map;
	});

	// Resolves a stored override (literal OR linked, possibly multi-hop) to a display string, null
	// meaning "unset" -- the UI's live mirror of resolve.ts's mergeAxisOverrides/resolveLinkedArg,
	// kept live by allAxisArgsQuery above.
	function resolveOverrideDisplayValue(ov: { axisId: string; value: any }): string | null {
		if (!ov.value) return null;
		if (ov.value.type === 'linked') {
			const source = resolveLinkedArg(ov.value.view_id, ov.value.kit_id, ov.axisId, argsByViewKitAll);
			return source?.type === 'literal' ? source.value : null;
		}
		return ov.value.type === 'literal' ? ov.value.value : null;
	}

	// Read-only, one row per axis the ACTIVE kit consumes, each carrying the ACTIVE view's CURRENT
	// pick for that (view, kit, axis) -- `null` when this view/kit has no axis_arg set (unset).
	// Dragged onto a `view`-typed token elsewhere in the panel: "make this child match what I (the
	// parent) currently am for this axis," including matching an unset axis, not "pick an arbitrary
	// value from the axis's full list" (that's still what the right-click "Add Axis" cascade is
	// for -- the two are complementary, not redundant). `sourceViewId`/`sourceKitId` are what the
	// drag payload actually writes as a live pointer -- `currentValue` is display-only, resolved
	// through resolveLinkedArg too since the ACTIVE view/kit's own axis may itself already be locked
	// (tracking some grandparent), in which case the naive literal-only read would wrongly show
	// "unset" instead of the true live value.
	const activeKitAxes = $derived.by(() => {
		if (!editorActivity.activeViewId || !editorActivity.activeKitId) return [];
		const currentByAxisId = new Map<string, string | null>();
		for (const arg of activeAxisArgsQuery.rows) {
			const resolved =
				arg.value?.type === 'linked'
					? resolveLinkedArg(arg.value.view_id, arg.value.kit_id, arg.axisId, argsByViewKitAll)
					: arg.value;
			currentByAxisId.set(arg.axisId, resolved?.type === 'literal' ? resolved.value : null);
		}
		const seen = new Map<
			string,
			{
				axisId: string;
				axisName: string | null;
				currentValue: string | null;
				sourceViewId: string;
				sourceKitId: string;
			}
		>();
		for (const a of axesConsumedQuery.rows) {
			if (a.kitId === editorActivity.activeKitId && !seen.has(a.axisId)) {
				seen.set(a.axisId, {
					axisId: a.axisId,
					axisName: a.axisName,
					currentValue: currentByAxisId.get(a.axisId) ?? null,
					sourceViewId: editorActivity.activeViewId,
					sourceKitId: editorActivity.activeKitId
				});
			}
		}
		return [...seen.values()];
	});

	let newTokenAlias = $state('');
	let newTokenValue = $state('');
	let newTokenValueType = $state<'scalar' | 'view'>('scalar');
	let newTokenViewId = $state<string | null>(null);
	let addingScope = $state<'project' | 'kit' | 'view' | null>(null);
	let editingAlias = $state<Record<string, boolean>>({});
	let editingValue = $state<Record<string, boolean>>({});
	let draftValue = $state<Record<string, string>>({});

	const viewName = $derived(
		activeViewQuery.rows.find((v) => v.viewId === editorActivity.activeViewId)?.viewName ?? 'View'
	);

	const kitName = $derived(
		activeKitQuery.rows.find((k) => k.kitId === editorActivity.activeKitId)?.kitName ?? 'Kit'
	);

	const viewNameById = $derived(
		new Map(activeViewQuery.rows.map((v) => [v.viewId, v.viewName] as const))
	);

	const axisNameById = $derived.by(() => {
		const map = new Map<string, string>();
		for (const a of axesConsumedQuery.rows) if (a.axisName) map.set(a.axisId, a.axisName);
		return map;
	});

	// Current axis overrides per `view`-typed token, keyed by tokenId -- fetched on demand (not a
	// live query) and explicitly refreshed after any add/cycle/remove action on that token.
	let overridesByToken = $state<Record<string, { axisId: string; value: any }[]>>({});
	async function loadOverridesForToken(tokenId: string) {
		overridesByToken[tokenId] = await api.getTokenAxisOverrides(tokenId).execute();
	}

	// Lazily populates overridesByToken for every currently-visible `view`-typed token. Reading
	// `overridesByToken` inside the membership check makes this effect re-run on every write to
	// it, but each re-run past the first is a no-op (already-cached keys are skipped), so it
	// converges rather than looping.
	$effect(() => {
		const allTokens = [
			...projectTokensQuery.rows,
			...kitTokensQuery.rows,
			...viewTokensQuery.rows
		] as TokenRow[];
		for (const t of allTokens) {
			if (t.tokenValue?.type !== 'view') continue;
			if (!(t.tokenId in overridesByToken)) loadOverridesForToken(t.tokenId);
		}
	});

	// Leaf action of the "Add Axis" cascade (Kit > Axis > Value, see tokenContextMenu) -- sets the
	// override to the SPECIFIC value the user picked, never an auto-picked default. Always a plain
	// literal snapshot, never linked -- picking an arbitrary value the source doesn't currently have
	// is the whole point of this path, as opposed to the drag-to-lock path (lockAxisToParent below),
	// which writes into a view's own axis_args instead of a token_axis_overrides row entirely.
	async function setAxisOverrideValue(tokenId: string, axisId: string, value: string) {
		await api.setTokenAxisOverride(tokenId, axisId, { type: 'literal', value });
		await loadOverridesForToken(tokenId);
	}

	// Drag-and-drop path only (see the token-item dropZone below) -- writes a LIVE pointer directly
	// into the TARGET VIEW's OWN axis_args for this (kit, axis) cell, so that pick tracks the source
	// live for EVERY occurrence of the target view anywhere in the project, not just this one
	// reference (the earlier, now-superseded design wrote into this ONE reference's
	// token_axis_overrides row instead -- see project_add_axis_cascade memory for why that changed).
	// Still reached by dropping onto a `view`-typed token row -- that's still how you reach "which
	// view" without leaving this panel -- but the write now targets that view's own canonical pick.
	// When the target view consumes this axis through 2+ different composed kits, locks the FIRST
	// match -- a rare edge case not worth a picker UI for now.
	async function lockAxisToParent(targetViewId: string, axisId: string, sourceViewId: string, sourceKitId: string) {
		const target = (axesByViewId.get(targetViewId) ?? []).find((a) => a.axisId === axisId);
		if (!target) return; // canDrop already gates on this axis being consumed by the target
		await api.setAxisArg(targetViewId, target.kitId, axisId, {
			type: 'linked',
			view_id: sourceViewId,
			kit_id: sourceKitId
		});
	}

	// No dedicated value-picker UI yet (foundation phase) -- clicking a LITERAL override row cycles
	// to the next literal/discrete value the axis has, wrapping around. A range-only axis has
	// nothing to cycle through and is a no-op. A LINKED override isn't a discrete pick to step
	// through at all (it's a pointer, not a value) -- the disabled button in the template already
	// keeps this from firing, but this guard stays defensive against any other future caller.
	async function cycleAxisOverrideValue(tokenId: string, axisId: string, currentValue: string) {
		const existing = (overridesByToken[tokenId] ?? []).find((o) => o.axisId === axisId);
		if (existing?.value?.type === 'linked') return;
		const values = await api.getAxisValuesByAxisId(axisId).execute();
		const picks = values.filter((v) => v.value?.type === 'literal' || v.value?.type === 'discrete');
		if (picks.length === 0) return;
		const idx = picks.findIndex((v) => v.value.value === currentValue);
		const next = picks[(idx + 1) % picks.length]!;
		await api.setTokenAxisOverride(tokenId, axisId, { type: 'literal', value: next.value.value });
		await loadOverridesForToken(tokenId);
	}

	async function removeAxisOverride(tokenId: string, axisId: string) {
		await api.clearTokenAxisOverride(tokenId, axisId);
		await loadOverridesForToken(tokenId);
	}

	// Read-only, one row per axis the REFERENCED view itself consumes, showing that view's own
	// CURRENT pick (resolved through any link chain via resolveLinkedArg) -- distinct from
	// overridesByToken above, which is this one OCCURRENCE's own explicit override
	// (token_axis_overrides). Since the drag-to-lock path (lockAxisToParent) writes into the
	// referenced view's own axis_args rather than into token_axis_overrides, that data never shows
	// up in the overrides list -- this is what makes a drag-linked axis visible in the panel at all.
	function viewAxisPicks(viewId: string) {
		return (axesByViewId.get(viewId) ?? []).map((a) => {
			const raw = argsByViewKitAll.get(`${viewId}::${a.kitId}`)?.[a.axisId];
			const resolved =
				raw?.type === 'linked'
					? resolveLinkedArg(raw.view_id, raw.kit_id, a.axisId, argsByViewKitAll)
					: raw;
			return {
				axisId: a.axisId,
				axisName: a.axisName,
				value: resolved?.type === 'literal' ? resolved.value : null,
				isLinked: raw?.type === 'linked'
			};
		});
	}

	async function addToken(scope: 'project' | 'kit' | 'view') {
		if (!newTokenAlias) return;
		if (newTokenValueType === 'scalar' && !newTokenValue) return;
		if (newTokenValueType === 'view' && !newTokenViewId) return;
		const projectId = editorActivity.activeProjectId;
		if (!projectId) return;

		const scopeObj =
			scope === 'kit' && editorActivity.activeKitId
				? { kitId: editorActivity.activeKitId }
				: scope === 'view' && editorActivity.activeViewId
					? { viewId: editorActivity.activeViewId }
					: undefined;

		const value: TokenValue =
			newTokenValueType === 'scalar'
				? { type: 'scalar', value: newTokenValue }
				: { type: 'view', view_id: newTokenViewId! };

		await api.createToken(projectId, newTokenAlias, value, scopeObj);
		newTokenAlias = '';
		newTokenValue = '';
		newTokenViewId = null;
		newTokenValueType = 'scalar';
		addingScope = null;
	}

	async function deleteToken(tokenId: string) {
		await api.deleteToken(tokenId);
	}

	async function renameToken(tokenId: string, alias: string) {
		await api.updateTokenAlias(tokenId, alias);
	}

	type TokenScope = 'project' | 'kit' | 'view';

	function tokenCurrentScope(tokenId: string): TokenScope | null {
		if ((projectTokensQuery.rows as TokenRow[]).some((t) => t.tokenId === tokenId)) return 'project';
		if ((kitTokensQuery.rows as TokenRow[]).some((t) => t.tokenId === tokenId)) return 'kit';
		if ((viewTokensQuery.rows as TokenRow[]).some((t) => t.tokenId === tokenId)) return 'view';
		return null;
	}

	let moveError = $state<string | null>(null);
	let moveErrorTimer: ReturnType<typeof setTimeout> | null = null;

	function flashMoveError(message: string) {
		moveError = message;
		if (moveErrorTimer) clearTimeout(moveErrorTimer);
		moveErrorTimer = setTimeout(() => (moveError = null), 3500);
	}

	// Real move (same row/id) via api.moveTokenScope -- never a copy. Blocks with an inline error
	// on an alias collision at the target scope rather than auto-renaming; the caller resolves it.
	async function moveTokenToScope(tokenId: string, target: TokenScope) {
		if (tokenCurrentScope(tokenId) === target) return;
		const newScope =
			target === 'project'
				? { projectOnly: true as const }
				: target === 'kit'
					? { kitId: editorActivity.activeKitId! }
					: { viewId: editorActivity.activeViewId! };
		const result = await api.moveTokenScope(tokenId, newScope);
		if (!result.ok) {
			flashMoveError(`This alias already exists in ${target} scope`);
		}
	}

	function tokenDropCanDrop(target: TokenScope) {
		return (payload: DragPayload) => {
			if (payload.kind !== 'token') return false;
			if (target === 'kit' && !editorActivity.activeKitId) return false;
			if (target === 'view' && !editorActivity.activeViewId) return false;
			return tokenCurrentScope(payload.tokenId) !== target;
		};
	}

	function tokenDropOnDrop(target: TokenScope) {
		return (payload: DragPayload) => {
			if (payload.kind !== 'token') return;
			moveTokenToScope(payload.tokenId, target);
		};
	}

	const tokenPanelContextMenu: ContextMenuContentGenerator = () => [
		{
			name: 'add',
			displayText: 'Add View Token',
			icon: 'fa-regular fa-window-maximize',
			onClick: () => {
				addingScope = 'view';
			}
		},
		{
			name: 'add',
			displayText: 'Add Kit Token',
			icon: 'fa-solid fa-puzzle-piece',
			onClick: () => {
				addingScope = 'kit';
			}
		},
		'hr',
		{
			name: 'add',
			displayText: 'Add Project Token',
			icon: 'fa-solid fa-diagram-project',
			onClick: () => {
				addingScope = 'project';
			}
		}
	];

	type CandidateAxis = { axisId: string; axisName: string | null; kitId: string; kitName: string | null };

	// Buckets a flat axis list by which kit each is consumed through, preserving first-seen order.
	function groupAxesByKit(axes: CandidateAxis[]): Map<string, { kitName: string | null; axes: CandidateAxis[] }> {
		const byKit = new Map<string, { kitName: string | null; axes: CandidateAxis[] }>();
		for (const a of axes) {
			const entry = byKit.get(a.kitId);
			if (entry) entry.axes.push(a);
			else byKit.set(a.kitId, { kitName: a.kitName, axes: [a] });
		}
		return byKit;
	}

	// One "Add Axis" menu entry for a single axis -- a leaf (sets the override directly) when the
	// axis has only one pick-able value, otherwise a Value submenu. An axis with zero pick-able
	// values (range-only) is dropped entirely by the caller before this runs.
	function axisMenuItem(tokenId: string, axis: CandidateAxis) {
		const values = axisValuesByAxisId.get(axis.axisId) ?? [];
		const base = {
			name: `add-axis-${axis.axisId}`,
			displayText: axis.axisName ?? 'Untitled axis',
			icon: 'fa-solid fa-plug'
		};
		if (values.length === 1) {
			return { ...base, onClick: () => setAxisOverrideValue(tokenId, axis.axisId, values[0]!.value.value) };
		}
		return {
			...base,
			submenu: values.map((v) => ({
				name: `add-axis-${axis.axisId}-${v.axisValueId}`,
				displayText: v.value.value,
				icon: 'fa-solid fa-plug',
				onClick: () => setAxisOverrideValue(tokenId, axis.axisId, v.value.value)
			}))
		};
	}

	function tokenContextMenu(tokenId: string): ContextMenuContentGenerator {
		return () => {
			const token = [...projectTokensQuery.rows, ...kitTokensQuery.rows, ...viewTokensQuery.rows].find(
				(t: TokenRow) => t.tokenId === tokenId
			);
			// `view`-typed tokens aren't editable via the plain-text value input (see the readonly
			// branch in tokenRow below) -- committing that input always writes back a scalar, which
			// would silently downgrade this token's type. Re-picking the target view isn't built yet.
			const isView = token?.tokenValue?.type === 'view';

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const items: any[] = [
				{
					name: 'rename',
					displayText: 'Rename',
					icon: 'fa-solid fa-i-cursor',
					// A `view`-typed row no longer displays its alias at all (icon + referenced view name
					// is the row's whole identity now) -- nothing left in the row for a rename to target.
					disabled: isView,
					onClick: () => {
						editingAlias[tokenId] = true;
					}
				},
				{
					name: 'editValue',
					displayText: 'Edit Value',
					icon: 'fa-solid fa-pencil',
					disabled: isView,
					onClick: () => {
						draftValue[tokenId] = tokenStr(token?.tokenValue) ?? '';
						editingValue[tokenId] = true;
					}
				}
			];

			if (isView && token?.tokenValue?.type === 'view') {
				const targetViewId = token.tokenValue.view_id;
				const alreadyOverridden = new Set(
					(overridesByToken[tokenId] ?? []).map((o) => o.axisId)
				);
				// Only axes with at least one pick-able (literal/discrete) value are offerable at all
				// -- a range-only axis has no simple value to set here (same rule the old auto-pick
				// stub applied).
				const available = (axesByViewId.get(targetViewId) ?? []).filter(
					(a) => !alreadyOverridden.has(a.axisId) && (axisValuesByAxisId.get(a.axisId)?.length ?? 0) > 0
				);
				const byKit = groupAxesByKit(available);
				// Skip the Kit level entirely when there's no real choice of kit (the common case),
				// mirroring export-profile.ts's "only show a picker when 2+ compete" precedent.
				const submenu =
					byKit.size <= 1
						? available.map((axis) => axisMenuItem(tokenId, axis))
						: [...byKit.entries()].map(([kitId, group]) => ({
								name: `add-axis-kit-${kitId}`,
								displayText: group.kitName ?? 'Untitled kit',
								icon: 'fa-solid fa-puzzle-piece',
								submenu: group.axes.map((axis) => axisMenuItem(tokenId, axis))
							}));
				items.push({
					name: 'add-axis',
					displayText: 'Add Axis',
					icon: 'fa-solid fa-plug',
					disabled: available.length === 0,
					submenu
				});
			}

			items.push(
				'hr',
				{
					name: 'delete',
					displayText: 'Delete',
					icon: 'fa-solid fa-trash-can',
					tone: 'destructive' as const,
					onClick: () => deleteToken(tokenId)
				}
			);

			return items;
		};
	}
</script>

<Panel
	contextMenuContent={tokenPanelContextMenu}
	name="Tokens"
	tooltip="Design tokens: Project, Kit, and View scoped"
>
	{#snippet content()}
		{#snippet tokenRow(
			token: TokenRow,
			scopeClass: string,
			showTrack: boolean,
			position: 'top' | 'mid' | 'bottom' | 'solo',
			scopeLabel: string
		)}
			<li
				class="token-item"
				class:token-item--top={position === 'top'}
				class:token-item--bottom={position === 'bottom'}
				class:token-item--mid={position === 'mid'}
				class:token-item--solo={position === 'solo'}
				use:dropZone={{
					accepts: ['axis-current'],
					canDrop: (p) => {
						if (token.tokenValue?.type !== 'view' || p.kind !== 'axis-current') return false;
						return (axesByViewId.get(token.tokenValue.view_id) ?? []).some((a) => a.axisId === p.axisId);
					},
					onDrop: (p) => {
						if (p.kind !== 'axis-current' || token.tokenValue?.type !== 'view') return;
						lockAxisToParent(token.tokenValue.view_id, p.axisId, p.sourceViewId, p.sourceKitId);
					}
				}}
			>
				<div
					class="token {scopeClass}"
					class:token--view={token.tokenValue?.type === 'view'}
					style="--color-icon: {tokenStr(token.tokenValue) ?? 'transparent'}"
					use:contextMenu={tokenContextMenu(token.tokenId)}
				>
					{#if token.tokenValue?.type === 'view'}
						{@const viewValue = token.tokenValue}
						<!-- The row's whole identity IS the referenced view -- icon + view name is the
						     prominent label, replacing the alias entirely (several `children`-aliased
						     tokens on one view would otherwise all read as "children"). Re-picking the
						     target isn't built yet: delete and recreate to point elsewhere. Axis overrides
						     nest below, outside this row (see the block after this snippet's closing div). -->
						<span
							class="token__name token__name--view"
							use:draggable={{
								disabled: false,
								preview: viewNameById.get(viewValue.view_id) ?? 'view',
								payload: () => ({
									kind: 'token',
									tokenId: token.tokenId,
									alias: token.tokenAlias ?? 'token',
									valueType: token.tokenValue?.type
								})
							}}
						>
							<i class="fa-regular fa-window-maximize token__icon"></i>
							<span class="token__view-name">{viewNameById.get(viewValue.view_id) ?? '?'}</span>
						</span>
						{#if showTrack}
							<button
								class="token__track"
								title="{scopeLabel}-scoped token · a same-alias View-scoped token would override this"
								type="button"
							>
								<i class="fa-solid fa-circle-dot"></i>
							</button>
						{/if}
					{:else}
						<span
							class="token__name"
							use:draggable={{
								disabled: editingAlias[token.tokenId] === true,
								preview: token.tokenAlias ?? 'token',
								payload: () => ({
									kind: 'token',
									tokenId: token.tokenId,
									alias: token.tokenAlias ?? 'token',
									valueType: token.tokenValue?.type
								})
							}}
						>
							<i
								class="fa-solid {tokenIcon(token.tokenValue)} token__icon"
								class:token__icon--color={isColorValue(token.tokenValue)}
							></i>
							<Renameable
								editing={editingAlias[token.tokenId] === true}
								value={token.tokenAlias ?? 'Unnamed'}
								onCommit={(name) => {
									renameToken(token.tokenId, name);
									editingAlias[token.tokenId] = false;
								}}
							>
								{token.tokenAlias ?? 'Unnamed'}
							</Renameable>
						</span>
						{#if showTrack}
							<button
								class="token__track"
								title="{scopeLabel}-scoped token · a same-alias View-scoped token would override this"
								type="button"
							>
								<i class="fa-solid fa-circle-dot"></i>
							</button>
						{/if}
						{#if editingValue[token.tokenId] === true}
							<input
								class="token__value-input"
								type="text"
								bind:value={draftValue[token.tokenId]}
								onblur={() => {
									const draft = draftValue[token.tokenId];
									if (draft !== undefined && draft !== tokenStr(token.tokenValue)) {
										api.updateTokenValue(token.tokenId, { type: 'scalar', value: draft });
									}
									editingValue[token.tokenId] = false;
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										const draft = draftValue[token.tokenId];
										if (draft !== undefined && draft !== tokenStr(token.tokenValue)) {
											api.updateTokenValue(token.tokenId, { type: 'scalar', value: draft });
										}
										editingValue[token.tokenId] = false;
									} else if (e.key === 'Escape') {
										draftValue[token.tokenId] = tokenStr(token.tokenValue) ?? '';
										editingValue[token.tokenId] = false;
									}
								}}
							/>
						{:else}
							<button
								class="token__value"
								class:token__value--new={!token.tokenValue}
								onclick={() => {
									draftValue[token.tokenId] = tokenStr(token.tokenValue) ?? '';
									editingValue[token.tokenId] = true;
								}}
							>
								{tokenStr(token.tokenValue) ?? '+'}
							</button>
						{/if}
					{/if}
				</div>
				{#if token.tokenValue?.type === 'view'}
					{@const viewValue = token.tokenValue}
					{@const overrides = overridesByToken[token.tokenId] ?? []}
					{#if overrides.length > 0}
						<ul class="token__axis-overrides">
							{#each overrides as ov (ov.axisId)}
								{@const isLinked = ov.value?.type === 'linked'}
								{@const displayValue = resolveOverrideDisplayValue(ov)}
								<li class="token__axis-override" class:token__axis-override--linked={isLinked}>
									<button
										type="button"
										class="token__axis-override-value"
										title={isLinked
											? 'Linked to the source axis -- drag a new source onto this token to relink'
											: 'Click to cycle value'}
										disabled={isLinked}
										onclick={() =>
											cycleAxisOverrideValue(token.tokenId, ov.axisId, displayValue ?? '')}
									>
										<i class="fa-solid {isLinked ? 'fa-link' : 'fa-plug'}"></i>
										<span>{axisNameById.get(ov.axisId) ?? ov.axisId}: {displayValue ?? 'unset'}</span>
									</button>
									<button
										type="button"
										class="token__axis-override-remove"
										aria-label="Remove axis override"
										title="Remove"
										onclick={() => removeAxisOverride(token.tokenId, ov.axisId)}
									>
										<i class="fa-solid fa-xmark"></i>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					{@const viewAxes = viewAxisPicks(viewValue.view_id)}
					{#if viewAxes.length > 0}
						<ul class="token__view-axes">
							{#each viewAxes as axis (axis.axisId)}
								<li class="token__view-axis">
									<i class="fa-solid {axis.isLinked ? 'fa-link' : 'fa-plug'}"></i>
									<span>{axis.axisName ?? axis.axisId}: {axis.value ?? 'unset'}</span>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</li>
		{/snippet}

		{#if moveError}
			<div class="token-move-error">{moveError}</div>
		{/if}

		<!-- View Tokens (only when a view is selected) -->
		{#if editorActivity.activeViewId}
			{@const viewRows = viewTokensQuery.rows as TokenRow[]}

			<details
				class="token-scope"
				open
				use:dropZone={{ accepts: 'token', canDrop: tokenDropCanDrop('view'), onDrop: tokenDropOnDrop('view') }}
			>
				<summary class="token-scope__header">
					<h3 class="token-scope__label">
						<i class="fa-regular fa-window-maximize"></i>
						{viewName}
					</h3>
					<i class="fa-solid fa-angle-down"></i>
				</summary>
				<div class="token-scope__tokens">
					{#if viewRows && viewRows.length > 0}
						<ul class="tokens-list">
							{#each viewRows as token, i (token.tokenId)}
								{@const pos =
									viewRows.length === 1
										? 'solo'
										: i === 0
											? 'top'
											: i === viewRows.length - 1
												? 'bottom'
												: 'mid'}
								{@render tokenRow(token, 'token--view', false, pos, 'View')}
							{/each}
						</ul>
					{:else}
						<span class="token-scope__empty">No view tokens</span>
					{/if}
				</div>
			</details>
		{/if}

		<!-- Kit Tokens (only when a kit is selected) -->
		{#if editorActivity.activeKitId}
			{@const kitRows = kitTokensQuery.rows as TokenRow[]}

			<details
				class="token-scope"
				open
				use:dropZone={{ accepts: 'token', canDrop: tokenDropCanDrop('kit'), onDrop: tokenDropOnDrop('kit') }}
			>
				<summary class="token-scope__header">
					<h3 class="token-scope__label">
						<i class="fa-solid fa-puzzle-piece"></i>
						{kitName}
					</h3>
					<i class="fa-solid fa-angle-down"></i>
				</summary>
				<div class="token-scope__tokens">
					{#if kitRows && kitRows.length > 0}
						<ul class="tokens-list">
							{#each kitRows as token, i (token.tokenId)}
								{@const pos =
									kitRows.length === 1
										? 'solo'
										: i === 0
											? 'top'
											: i === kitRows.length - 1
												? 'bottom'
												: 'mid'}
								{@render tokenRow(token, 'token--kit', true, pos, 'Kit')}
							{/each}
						</ul>
					{:else}
						<span class="token-scope__empty">No kit tokens</span>
					{/if}
				</div>
				{#if activeKitAxes.length > 0}
					<!-- Read-only, one row per axis this kit consumes, showing the active VIEW's own
					     CURRENT pick for that axis (or "unset") -- drag it onto any `view`-typed token
					     above to make that child match what this (parent) view currently is for the
					     axis, unset included. Never editable here; axis values themselves are authored
					     in the Axes panel, and picking an ARBITRARY value (not just mirroring the
					     parent) is still the right-click "Add Axis" cascade's job. -->
					<div class="kit-axes">
						<h4 class="kit-axes__label">Axes</h4>
						<ul class="kit-axes__list">
							{#each activeKitAxes as axis (axis.axisId)}
								<li
									class="kit-axes__axis"
									use:draggable={{
										preview: `${axis.axisName ?? 'axis'}: ${axis.currentValue ?? 'unset'}`,
										payload: () => ({
											kind: 'axis-current',
											axisId: axis.axisId,
											value: axis.currentValue,
											sourceViewId: axis.sourceViewId,
											sourceKitId: axis.sourceKitId
										})
									}}
								>
									<span class="kit-axes__axis-name">{axis.axisName ?? 'Untitled axis'}</span>
									<span class="kit-axes__axis-value" class:kit-axes__axis-value--unset={!axis.currentValue}>
										{axis.currentValue ?? 'unset'}
									</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</details>
		{/if}

		<!-- Project Tokens -->
		{@const projectRows = projectTokensQuery.rows as TokenRow[]}

		<details
			class="token-scope"
			open
			use:dropZone={{
				accepts: 'token',
				canDrop: tokenDropCanDrop('project'),
				onDrop: tokenDropOnDrop('project')
			}}
		>
			<summary class="token-scope__header">
				<h3 class="token-scope__label">
					<i class="fa-solid fa-diagram-project"></i>
					{editorActivity.activeProjectName ?? 'Project'}
				</h3>
				<i class="fa-solid fa-angle-down"></i>
			</summary>
			<div class="token-scope__tokens">
				{#if projectRows && projectRows.length > 0}
					<ul class="tokens-list">
						{#each projectRows as token, i (token.tokenId)}
							{@const pos =
								projectRows.length === 1
									? 'solo'
									: i === 0
										? 'top'
										: i === projectRows.length - 1
											? 'bottom'
											: 'mid'}
							{@render tokenRow(token, 'token--project', false, pos, 'Project')}
						{/each}
					</ul>
				{:else}
					<span class="token-scope__empty">No project tokens</span>
				{/if}
			</div>
		</details>

		<!-- Add token form -->
		{#if addingScope}
			<form
				class="token-add"
				onsubmit={(e) => {
					e.preventDefault();
					addToken(addingScope!);
				}}
			>
				<select bind:value={newTokenValueType} class="token-add__scope">
					<option value="scalar">Scalar</option>
					<option value="view">View</option>
				</select>
				<select bind:value={addingScope} class="token-add__scope">
					{#if editorActivity.activeViewId}
						<option value="view">View</option>
					{/if}
					{#if editorActivity.activeKitId}
						<option value="kit">Kit</option>
					{/if}
					<option value="project">Project</option>
				</select>
				<input
					type="text"
					bind:value={newTokenAlias}
					placeholder="alias"
					class="token-add__input"
				/>
				{#if newTokenValueType === 'scalar'}
					<input
						type="text"
						bind:value={newTokenValue}
						placeholder="value"
						class="token-add__input"
					/>
				{:else}
					<select bind:value={newTokenViewId} class="token-add__view-select">
						<option value={null} disabled selected>Pick a view…</option>
						{#each activeViewQuery.rows as view (view.viewId)}
							<option value={view.viewId}>{view.viewName}</option>
						{/each}
					</select>
				{/if}
				<button
					type="submit"
					disabled={!newTokenAlias ||
						(newTokenValueType === 'scalar' ? !newTokenValue : !newTokenViewId)}
					class="token-add__btn">Add</button
				>
				<button
					type="button"
					onclick={() => {
						addingScope = null;
						newTokenAlias = '';
						newTokenValue = '';
						newTokenViewId = null;
						newTokenValueType = 'scalar';
					}}
					class="token-add__btn token-add__btn--cancel">✕</button
				>
			</form>
		{/if}
	{/snippet}
</Panel>

<style lang="scss" global>
	@use '_index' as *;

	.token-move-error {
		margin: $x-space-xs;
		padding: calc($x-space-xs / 2) $x-space-sm;
		border-radius: 4px;
		background: var(--color-error, oklch(58% 0.22 25));
		color: var(--color-error-text, oklch(98% 0 0));
		font-size: $x-font-size-xs;
	}

	.token-scope {
		@include layout-flex-column();

		&.dnd-over {
			outline: 2px solid var(--color-primary);
			outline-offset: -2px;
		}

		summary {
			list-style: none;
			display: flex;
			padding-block: $x-space-xs;
			padding-inline: $x-space-sm;
			align-items: center;
			justify-content: space-between;
			cursor: pointer;
			user-select: none;
			font-size: $x-font-size-xs;
			text-transform: uppercase;
			@include fonts-stack('Satoshi-Bold', sans);
			color: var(--color-text);

			&:hover {
				background: var(--color-surface-alt);
			}

			i.fa-angle-down {
				position: relative;
				right: $x-space-sm;
				transition: rotate 200ms ease-out;
			}
		}

		&[open] {
			summary {
				i.fa-angle-down {
					rotate: 180deg;
				}
			}
		}

		width: 100%;
	}

	.token-scope__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.token-scope__label {
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		margin: 0;
		color: var(--color-text);
	}

	.token-scope__tokens {
		padding-left: $x-space-sm;
		padding-bottom: $x-space-xs;
		overflow-y: auto;
		max-height: 16vh;
		scrollbar-width: thin;
	}

	.token-scope__empty {
		padding-left: $x-space-sm;
		padding-bottom: $x-space-xs;
		font-size: $x-font-size-xs;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.tokens-list {
		@include layout-flex-column();
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.token-item {
		display: flex;
		// Column, not row: a `view`-typed token's nested axis-override list (see
		// .token__axis-overrides) sits BELOW its header row, not beside it -- this used to not
		// matter when `.token` was this item's only child.
		flex-direction: column;

		$border-rad: calc($x-space-xs / 2);

		&--top > .token > .token__value,
		&--top > .token > .token__value-input {
			border-radius: $border-rad $border-rad 0 0;
		}

		&--bottom > .token > .token__value,
		&--bottom > .token > .token__value-input {
			border-radius: 0 0 $border-rad $border-rad;
		}

		&--mid > .token > .token__value,
		&--mid > .token > .token__value-input {
			border-radius: 0;
		}

		&--solo > .token > .token__value,
		&--solo > .token > .token__value-input {
			border-radius: $border-rad;
		}
	}

	.token {
		color: var(--color-text);
		user-select: none;
		padding-inline: $x-space-sm;
		text-align: left;
		@include fonts-stack('Satoshi-Regular', sans);
		font-weight: 600;
		font-size: $x-font-size-sm;
		letter-spacing: 1px;
		width: 100%;
		display: flex;
		align-items: center;
		cursor: pointer;

		&:nth-of-type(even) {
			background: var(--color-surface-alt);
		}

		&:hover {
			color: var(--color-primary);
		}

		// `.token--view` (bound in the template) has no rules of its own -- a `view`-typed token's
		// row IS its referenced view (icon + name is the row's whole prominent label, in
		// `.token__name--view` below, no separate alias or value slot); axis overrides nest in a
		// separate sibling <ul> below (.token__axis-overrides), not inside this row.
	}

	.token__name--view {
		.token__icon {
			opacity: 0.6;
		}
	}

	.token__view-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	// Nested plug-icon `axis:value` rows under a `view`-typed token, added via the row's
	// right-click "Add Axis" menu. Indented past the header's icon, mirroring ChildViewField's own
	// nested child-row indentation (see project-view-array-display-revamp for the shared pattern).
	.token__axis-overrides {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding-left: calc($x-space-sm + $x-space-md);
		padding-right: $x-space-sm;
		padding-bottom: calc($x-space-xs / 2);
	}

	.token__axis-override {
		display: flex;
		align-items: center;
		border-radius: 1px;
		background: var(--color-panel-header-fill);
		font-size: $x-font-size-sm;

		&:hover {
			background: var(--color-surface-alt);
		}
	}

	.token__axis-override-value {
		all: unset;
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		flex: 1;
		min-width: 0;
		padding: calc($x-space-xs / 2) $x-space-xs;
		cursor: pointer;
		color: var(--color-text);

		span {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		i {
			flex: 0 0 auto;
			font-size: $x-font-size-xs;
			opacity: 0.6;
		}

		&:hover {
			color: var(--color-primary);
		}

		// A linked override isn't a discrete pick to step through -- no hover/cursor affordance
		// implying it cycles, since clicking it does nothing (see cycleAxisOverrideValue's guard).
		&:disabled {
			cursor: default;

			&:hover {
				color: var(--color-text);
			}
		}
	}

	.token__axis-override-remove {
		all: unset;
		flex: 0 0 auto;
		cursor: pointer;
		padding-inline: calc($x-space-xs / 2);
		opacity: 0.5;
		color: var(--color-text);

		&:hover {
			opacity: 1;
			color: var(--color-danger, var(--color-text));
		}
	}

	// Read-only mirror of the referenced view's own current axis picks (see viewAxisPicks) --
	// separate from .token__axis-overrides above, which is this one occurrence's own explicit,
	// editable override. No buttons, no hover-as-interactive affordance: this section only ever
	// reflects state owned elsewhere (the view's own axis_args, authored in the Axes panel or via
	// the kit-axes drag-to-lock below).
	.token__view-axes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding-left: calc($x-space-sm + $x-space-md);
		padding-right: $x-space-sm;
		padding-bottom: calc($x-space-xs / 2);
	}

	.token__view-axis {
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		border-radius: 1px;
		background: var(--color-panel-header-fill);
		font-size: $x-font-size-sm;
		padding: calc($x-space-xs / 2) $x-space-xs;
		color: var(--color-text-muted);

		i {
			flex: 0 0 auto;
			font-size: $x-font-size-xs;
			opacity: 0.6;
		}

		span {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	// Read-only draggable "palette" of the active kit's own consumed axes -- see the kit-axes
	// block in the Kit Tokens section above. Sits below the kit's token list, inside the same
	// <details>, so collapsing the kit section hides both together.
	.kit-axes {
		border-top: 1px solid var(--color-border, oklch(50% 0 0 / 0.15));
		padding: $x-space-sm;
	}

	.kit-axes__label {
		margin: 0 0 $x-space-xs;
		font-size: $x-font-size-xs;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		opacity: 0.6;
	}

	.kit-axes__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	// Each row IS the drag source (one axis, its CURRENT value) -- not a list of picks.
	.kit-axes__axis {
		cursor: grab;
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		border-radius: 1px;
		background: var(--color-panel-header-fill);
		font-size: $x-font-size-sm;
		padding: calc($x-space-xs / 2) $x-space-xs;
		color: var(--color-text);

		&:hover {
			background: var(--color-surface-alt);
			color: var(--color-primary);
		}
	}

	.kit-axes__axis-name {
		opacity: 0.8;
	}

	.kit-axes__axis-value {
		font-weight: 600;
	}

	.kit-axes__axis-value--unset {
		opacity: 0.6;
		font-style: italic;
		font-weight: normal;
	}

	.token__icon {
		padding-right: calc($x-space-xs / 2);
	}

	.token__icon--color {
		-webkit-text-stroke: 1px black;
		color: var(--color-icon, var(--color-text));
	}

	.token__track {
		all: unset;
		font-size: $x-font-size-sm;
		color: var(--color-text);
		padding-inline: calc($x-space-xs / 2);
		cursor: pointer;
	}

	.token__name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding-inline: calc($x-space-xs / 2);

		// Draggable (onto a Render field), but hover keeps the normal cursor -- only an in-flight
		// drag reads as grabbing.
		&.dnd-dragging {
			opacity: 0.4;
			cursor: grabbing;
		}
	}

	.token__value {
		all: unset;
		flex-basis: 40%;
		flex-shrink: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
		padding: calc($x-space-xs / 2) $x-space-sm;
		cursor: pointer;
		color: var(--color-add-var-text);
		font-size: $x-font-size-sm;
		background: var(--color-panel-header-fill);
		border-radius: 1px;

		&:hover {
			background: var(--color-surface-alt);
			color: var(--color-text);
		}

		&--new {
			cursor: pointer;
			text-align: center;
		}

		&--readonly {
			cursor: default;
			opacity: 0.75;
		}
	}

	.token__value-input {
		all: unset;
		font-size: $x-font-size-sm;
		flex-basis: 40%;
		flex-shrink: 1;
		text-align: center;
		padding: calc($x-space-xs / 2);
		background: var(--color-pure);
		color: var(--color-text);
		border: 1px solid var(--color-primary);
		border-radius: 1px;
		outline: none;
	}

	.token-add {
		display: flex;
		flex-wrap: wrap;
		gap: calc($x-space-xs / 2);
		padding: $x-space-xs;
		align-items: center;

		&__scope {
			font-size: $x-font-size-xs;
			padding: 2px 4px;
		}

		&__input {
			font-size: $x-font-size-xs;
			padding: 2px 4px;
			width: 6ch;
			min-width: 0;

			&:nth-of-type(2) {
				width: 10ch;
			}
		}

		&__view-select {
			font-size: $x-font-size-xs;
			padding: 2px 4px;
			max-width: 12ch;
		}

		&__btn {
			font-size: $x-font-size-xs;
			padding: 2px 6px;
			border: 1px solid var(--color-text-muted);
			background: var(--color-pure);
			color: var(--color-text);
			cursor: pointer;

			&:disabled {
				opacity: 0.4;
				cursor: not-allowed;
			}

			&--cancel {
				border-color: transparent;
			}
		}
	}
</style>
