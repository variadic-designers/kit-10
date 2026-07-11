<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { ContextMenuContentGenerator } from '$lib/components/contextMenu';
	import Panel from '../Panel.svelte';
	import { liveQuery, type EditorActivity } from '../Editor.svelte';
	import { importAssetFile, removeAsset } from '../assetStore.ts';
	import { assetRegister } from '../assetStore.ts';
	import { assetBytes } from '../asset-bytes.ts';
	import type { EditorState } from 'manager';
	import type { Api } from 'manager';

	type ViewMode = 'list' | 'thumbnail';

	type AssetsPanelProps = {
		api: Api;
		editorReady: EditorState;
		editorActivity: EditorActivity;
	};

	let { api, editorReady, editorActivity = $bindable() }: AssetsPanelProps = $props();

	const assetsQuery = liveQuery((api, activity) => {
		return api.getAssetsByProjectId(activity.activeProjectId);
	});

	// Sync live query results into the shared assetRegister store so other components
	// (StyleField's asset picker) can access the asset list without their own query.
	$effect(() => {
		const rows = assetsQuery.rows as {
			assetId: string;
			assetName: string;
			assetMimeType: string;
			assetChecksum: string;
			assetLink: string;
			assetWidth: number;
			assetHeight: number;
			assetCreatedAt: Date;
		}[];
		const records = rows.map((r) => ({
			id: r.assetId,
			name: r.assetName,
			mimeType: r.assetMimeType,
			checksum: r.assetChecksum,
			link: r.assetLink,
			width: r.assetWidth,
			height: r.assetHeight,
			createdAt: r.assetCreatedAt
		}));
		console.log('[Assets] live query synced', records.length, 'assets');
		assetRegister.set(records);
	});

	let pendingFiles = $state<string[]>([]);
	let viewMode = $state<ViewMode>('list');
	let thumbnails = $state(new Map<string, string>());

	async function blobUrlForAsset(assetId: string, mimeType: string): Promise<string | null> {
		try {
			const bytes = await assetBytes.get(assetId);
			if (!bytes) return null;
			const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
			return URL.createObjectURL(blob);
		} catch {
			return null;
		}
	}

	async function loadThumbnails() {
		const results = await Promise.all(
			assetsQuery.rows.map(async (asset) => {
				if (thumbnails.has(asset.assetId)) return null;
				const url = await blobUrlForAsset(asset.assetId, asset.assetMimeType);
				return url ? ([asset.assetId, url] as const) : null;
			})
		);
		for (const entry of results) {
			if (entry) thumbnails.set(entry[0], entry[1]);
		}
	}

	async function cacheThumbnail(assetId: string, mimeType: string) {
		const url = await blobUrlForAsset(assetId, mimeType);
		if (url) thumbnails.set(assetId, url);
	}

	function toggleViewMode() {
		const next: ViewMode = viewMode === 'list' ? 'thumbnail' : 'list';
		viewMode = next;
		if (next === 'thumbnail' && thumbnails.size === 0 && assetsQuery.rows.length > 0) {
			loadThumbnails();
		}
	}

	onDestroy(() => {
		for (const url of thumbnails.values()) URL.revokeObjectURL(url);
	});

	const assetPanelContextMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'import_asset',
				displayText: 'Import Asset',
				icon: 'fa-solid fa-file-arrow-up',
				onClick: () => triggerImport()
			},
			{
				name: 'toggle_view',
				displayText: viewMode === 'list' ? 'Switch to Thumbnail View' : 'Switch to List View',
				icon: viewMode === 'list' ? 'fa-solid fa-th' : 'fa-solid fa-list',
				onClick: () => toggleViewMode()
			}
		];
	};

	let fileInput: HTMLInputElement | undefined = $state();

	function triggerImport() {
		fileInput?.click();
	}

	function onFilePicked(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		if (files.length === 0 || !editorActivity.activeProjectId) return;

		const names = files.map((f) => f.name);
		pendingFiles = [...pendingFiles, ...names];

		for (const file of files) {
			importAssetFile(api, editorActivity.activeProjectId!, file)
				.then((record: import('../assetStore.ts').AssetRecord | null) => {
					if (record) cacheThumbnail(record.id, record.mimeType);
				})
				.catch((e: unknown) => console.error('Failed to import:', file.name, e))
				.finally(() => {
					pendingFiles = pendingFiles.filter((n) => n !== file.name);
				});
		}

		input.value = '';
	}

	async function handleRemove(assetId: string) {
		const url = thumbnails.get(assetId);
		if (url) URL.revokeObjectURL(url);
		await removeAsset(api, assetId);
	}
</script>

<input
	type="file"
	multiple
	accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml"
	bind:this={fileInput}
	onchange={onFilePicked}
	style="display: none"
/>

<Panel name="Assets" tooltip="Project assets (images)" contextMenuContent={assetPanelContextMenu}>
	{#snippet content()}
		{#if assetsQuery.rows.length === 0 && pendingFiles.length === 0}
			<p class="empty">
				No assets imported yet. Right-click or use the panel menu to import an image.
			</p>
		{:else if viewMode === 'thumbnail'}
			<div class="asset-thumbnails">
				{#each assetsQuery.rows as asset (asset.assetId)}
					{@const blobUrl = thumbnails.get(asset.assetId)}
					<div class="asset-thumb">
						<div class="asset-thumb__frame">
							{#if blobUrl}
								<img
									src={blobUrl}
									alt={asset.assetName}
									loading="lazy"
									onerror={(e) => {
										(e.target as HTMLImageElement).style.display = 'none';
									}}
								/>
							{:else}
								<i class="fa-solid fa-image"></i>
							{/if}
						</div>
						<span class="asset-thumb__name">{asset.assetName}</span>
						<button
							class="asset-thumb__remove"
							onclick={() => handleRemove(asset.assetId)}
							title="Remove asset"
						>
							<i class="fa-solid fa-trash-can"></i>
						</button>
					</div>
				{/each}
				{#each pendingFiles as name}
					<div class="asset-thumb asset-thumb--pending">
						<div class="asset-thumb__frame">
							<i class="fa-solid fa-spinner fa-spin"></i>
						</div>
						<span class="asset-thumb__name">{name}</span>
					</div>
				{/each}
			</div>
		{:else}
			<ul class="asset-list">
				{#each assetsQuery.rows as asset (asset.assetId)}
					<li class="asset-item">
						<i class="fa-solid fa-image"></i>
						<span class="asset-name">{asset.assetName}</span>
						<span class="asset-dims">{asset.assetWidth}&times;{asset.assetHeight}</span>
						<button
							class="asset-remove"
							onclick={() => handleRemove(asset.assetId)}
							title="Remove asset"
						>
							<i class="fa-solid fa-trash-can"></i>
						</button>
					</li>
				{/each}
				{#each pendingFiles as name}
					<li class="asset-item">
						<i class="fa-solid fa-spinner fa-spin"></i>
						<span class="asset-name">{name}</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

	.empty {
		padding: $x-space-sm;
		color: var(--color-text-muted);
		@include fonts-stack('Satoshi-Light', sans);
		font-size: $x-font-size-xs;
	}

	.asset-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.asset-item {
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		padding: $x-space-xs $x-space-sm;

		&:hover {
			background: var(--color-surface-alt);
		}

		i {
			color: var(--color-text-muted);
			font-size: $x-font-size-xs;
		}

		.asset-name {
			@include fonts-stack('Satoshi-Regular', sans);
			font-size: $x-font-size-xs;
			color: var(--color-text);
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.asset-dims {
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
			flex-shrink: 0;
		}

		.asset-remove {
			border: none;
			background: transparent;
			color: var(--color-text-muted);
			cursor: pointer;
			padding: 2px;
			font-size: $x-font-size-xs;
			opacity: 0;
			transition: opacity 100ms;

			:global(.asset-item:hover) & {
				opacity: 1;
			}

			&:hover {
				color: var(--color-danger);
			}
		}
	}

	.asset-thumbnails {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: $x-space-xs;
		padding: $x-space-xs;
	}

	.asset-thumb {
		position: relative;
		border-radius: calc($x-space-xs / 2);
		overflow: hidden;
		background: var(--color-surface-alt);

		&:hover {
			background: var(--color-surface-hover);
		}

		&__frame {
			aspect-ratio: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			overflow: hidden;

			img {
				width: 100%;
				height: 100%;
				object-fit: cover;
				display: block;
			}

			i {
				font-size: 2rem;
				color: var(--color-text-muted);
			}
		}

		&__name {
			display: block;
			padding: $x-space-xxs $x-space-xs;
			@include fonts-stack('Satoshi-Regular', sans);
			font-size: $x-font-size-xs;
			color: var(--color-text);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		&__remove {
			position: absolute;
			top: 4px;
			right: 4px;
			border: none;
			background: rgba(0, 0, 0, 0.5);
			color: #fff;
			cursor: pointer;
			padding: 4px;
			border-radius: calc($x-space-xs / 2);
			font-size: $x-font-size-xs;
			opacity: 0;
			transition: opacity 100ms;

			.asset-thumb:hover & {
				opacity: 1;
			}

			&:hover {
				background: rgba(200, 0, 0, 0.7);
			}
		}
	}
</style>
