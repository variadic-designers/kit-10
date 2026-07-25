<script lang="ts">
	import { onMount, type Component } from 'svelte';

	// Dynamic + onMount-gated so the editor's client-only stack (PGlite, Vellum WASM,
	// Charter WASM) never enters the server's static module graph -- a top-level import
	// here gets bundled into the server chunk regardless of the route's `ssr` setting.
	let EditorComponent: Component | undefined = $state();

	onMount(async () => {
		EditorComponent = (await import('$lib/editor/Editor.svelte')).default;
	});
</script>

{#if EditorComponent}
	<EditorComponent />
{/if}