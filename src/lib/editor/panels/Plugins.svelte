<script lang="ts" module>
	import createPlugin, { type ManifestLike } from '@extism/extism';

	// 1. Wrap your plugin creation in a helper function that takes the plugin's metadata
	function initPlugin(manifest: ManifestLike | PromiseLike<ManifestLike>, pluginName: string) {
		let localKV = $state(new Map());

		return createPlugin(manifest, {
			runInWorker: true,
			useWasi: true,
			functions: {
				'extism:host/user': {
					kit10_log(cp, inputOffs: bigint) {
						const rawJson = cp.read(inputOffs).text();
						const {
							level,
							message
						}: { level: 'debug' | 'info' | 'warn' | 'error'; message: string } =
							JSON.parse(rawJson);

						const colors = {
							debug: 'color: #6b7280;', // gray
							info: 'color: #3b82f6;', // blue
							warn: 'color: #f59e0b;', // yellow
							error: 'color: #ef4444;' // red
						};

						const color = colors[level] ?? colors.info;
						const now = new Date();
						const timestamp = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}.${now.getMilliseconds()}`;

						// 2. We inject the pluginName variable here via Javascript closure.
						// The WASM guest didn't pass this; the host bakes it in on initialization.
						console.log(
							`%c[${level.toUpperCase().padEnd(5)} ${pluginName}]%c ${timestamp} -> ${message}`,
							`${color}; font-weight: bold;`,
							'color:inherit'
						);
					},
					// kit10_kv_get stays the same because its input is plain text 'string'
					kit10_kv_get(cp, keyOffs: bigint) {
						const key = cp.read(keyOffs).text();
						const value = localKV.get(key) || '';
						return cp.store(value);
					},

					// FIXED: Receives one pointer to a JSON KeyValuePair structure
					kit10_kv_set(cp, inputOffs: bigint) {
						const rawJson = cp.read(inputOffs).text();
						const { key, value } = JSON.parse(rawJson); // Parse the schema object

						localKV.set(key, value);

						// Your schema says this returns a JSON boolean, so we must return a pointer to it
						return cp.store(JSON.stringify(true));
					}
				}
			}
		});
	}
</script>

<script lang="ts">
	import type { ContextMenuContentGenerator } from '$lib/components/contextMenu';
	import Panel from '../Panel.svelte';

	const pluginPanelContextMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'import_plugin',
				displayText: 'Import Plugin',
				icon: 'fa-solid fa-microchip',
				onClick: () => {}
			}
		];
	};

	const pluginListingContextMenu: ContextMenuContentGenerator = () => [
		{
			name: 'rename_project',
			displayText: 'Rename',
			icon: 'fa-solid fa-i-cursor',
			onClick: () => {}
		}
	];

	import { onMount } from 'svelte';

	onMount(() => {
		console.log('About to run local plugin');

		const manifest = {
			wasm: [
				{
					url: '/coloors.wasm'
				}
			]
		};

		initPlugin(manifest, 'coloors').then(async (p) => {
			await p.call('on_init', 'Hi we are bridged to plugin!');

			const eventResult = await p.call(
				'on_event',
				JSON.stringify({
					event_name: 'axes_updated',
					timestamp: Date.now()
				})
			);

			if (eventResult) {
				console.log('Event processing output:', eventResult.text());
			}
		});
	});
</script>

<Panel name="Plugins" tooltip="Plugins" contextMenuContent={pluginPanelContextMenu}>
	{#snippet content()}
		Plugins
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;
</style>
