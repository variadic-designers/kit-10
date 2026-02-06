<script lang="ts">
	import Editor from '$lib/editor/Editor.svelte';
	import type { Kit10Project } from '$lib/types';

	const { data }: { data: Kit10Project } = $props();
</script>

<Editor {...data} />
