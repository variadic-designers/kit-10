<script lang="ts">
	// Static build/version facts. Kept literal (not imported) so About stays a zero-dependency panel.
	const APP_VERSION = '0.0.1';
	const SCHEMA_VERSION = '2026-07-11';
	const RENDERER = 'Vellum (WGPU, Display-P3)';
</script>

<div class="tab">
	<div class="brand">
		<img src="/favicon.svg" alt="KIT-10" />
		<div>
			<h2>KIT·10</h2>
			<p>A design-system editor — kits, axes, and views.</p>
		</div>
	</div>

	<dl class="facts">
		<div><dt>App version</dt><dd>{APP_VERSION}</dd></div>
		<div><dt>Schema</dt><dd>{SCHEMA_VERSION}</dd></div>
		<div><dt>Renderer</dt><dd>{RENDERER}</dd></div>
	</dl>

	<div class="links">
		<a class="link" href="https://ko-fi.com/yorqat" target="_blank" rel="noreferrer">
			<i class="fa-solid fa-gift"></i> Support the project
		</a>
	</div>
</div>

<style lang="scss">
	@use '_index' as *;

	.tab {
		@include layout-flex-column();
		gap: $x-space-md;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: $x-space-sm;

		img {
			width: calc($x-space-xl);
			height: calc($x-space-xl);
		}

		h2 {
			@include fonts-stack('Satoshi-Regular', sans);
			font-weight: 700;
			color: var(--color-text);
		}
		p {
			color: var(--color-text-muted);
			font-size: $x-font-size-sm;
		}
	}

	.facts {
		@include layout-flex-column();
		gap: 2px;

		div {
			display: flex;
			justify-content: space-between;
			padding: calc($x-space-xs / 2) $x-space-xs;
			background: var(--color-surface);
			border-radius: calc($x-space-xs / 2);
		}
		dt {
			color: var(--color-text-muted);
			font-size: $x-font-size-sm;
			text-transform: uppercase;
			letter-spacing: 1px;
		}
		dd {
			@include fonts-stack('Satoshi-Regular', sans);
			color: var(--color-text);
		}
	}

	.links .link {
		display: inline-flex;
		align-items: center;
		gap: $x-space-xs;
		color: var(--color-primary);
		text-decoration: none;
		font-size: $x-font-size-md;

		&:hover {
			text-decoration: underline;
		}
	}
</style>
