<script lang="ts">
	import Editor from '$lib/editor/Editor.svelte';
	import Layout from '$lib/editor/Layout.svelte';
	import type { Kit10Project } from '$lib/types';

	const { data }: { data: Kit10Project } = $props();
</script>

<Editor {...data} />
<!-- <Layout> -->
<!--   {#snippet nav()} -->
<!--     We're at Nav -->
<!--   {/snippet} -->
<!---->
<!--   {#snippet dash()} -->
<!--     We're at Dash -->
<!--   {/snippet} -->
<!---->
<!--   {#snippet management()} -->
<!--     We're at Management -->
<!--   {/snippet} -->
<!---->
<!--   {#snippet configurable()} -->
<!--     We're at Configurable -->
<!--   {/snippet} -->
<!---->
<!--   {#snippet console()} -->
<!--     We're at Console -->
<!--   {/snippet} -->
<!-- </Layout> -->
