<script lang="ts">
	import { account, updateAccount, toggleConnectedApp, ACHIEVEMENTS } from '../account.js';

	let draftName = $state($account.username);

	function commitName() {
		const name = draftName.trim();
		if (name && name !== $account.username) updateAccount({ username: name });
	}

	const earnedCount = $derived(ACHIEVEMENTS.filter((a) => a.earned).length);
</script>

<div class="tab">
	<section>
		<label class="field-label" for="account-username">Username</label>
		<input
			id="account-username"
			class="text"
			bind:value={draftName}
			onblur={commitName}
			onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
		/>
	</section>

	<section>
		<h3>Achievements <span class="tally">{earnedCount}/{ACHIEVEMENTS.length}</span></h3>
		<ul class="achievements">
			{#each ACHIEVEMENTS as a (a.id)}
				<li class:earned={a.earned} title={a.description}>
					<i class={a.icon}></i>
					<div class="body">
						<span class="name">{a.label}</span>
						<span class="desc">{a.description}</span>
					</div>
					{#if a.earned}
						<i class="fa-solid fa-circle-check tick"></i>
					{:else}
						<i class="fa-solid fa-lock lock"></i>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h3>Connected apps</h3>
		<ul class="apps">
			{#each $account.connectedApps as app (app.id)}
				<li>
					<i class={app.icon}></i>
					<span class="name">{app.label}</span>
					<button
						class="conn"
						class:on={app.connected}
						onclick={() => toggleConnectedApp(app.id)}
					>
						{app.connected ? 'Disconnect' : 'Connect'}
					</button>
				</li>
			{/each}
		</ul>
	</section>
</div>

<style lang="scss">
	@use '_index' as *;

	.tab {
		@include layout-flex-column();
		gap: $x-space-md;
	}

	section {
		@include layout-flex-column();
		gap: $x-space-xs;
	}

	.field-label,
	h3 {
		font-size: $x-font-size-sm;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 1px;
		@include fonts-stack('Satoshi-Light', sans);
	}

	h3 {
		display: flex;
		align-items: center;
		gap: $x-space-xs;

		.tally {
			color: var(--color-primary);
		}
	}

	.text {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-bg);
		border-radius: calc($x-space-xs / 2);
		padding: calc($x-space-xs / 2) $x-space-xs;
		font-size: $x-font-size-md;
		@include fonts-stack('Satoshi-Regular', sans);
		max-width: calc($x-space-xxxl * 2);
	}

	ul {
		@include layout-flex-column();
		gap: 2px;
	}

	.achievements li {
		display: flex;
		align-items: center;
		gap: $x-space-sm;
		padding: $x-space-xs;
		border-radius: calc($x-space-xs / 2);
		background: var(--color-surface);
		opacity: 0.5;

		&.earned {
			opacity: 1;
		}

		> i:first-child {
			color: var(--color-primary);
			width: 1.2em;
			text-align: center;
		}

		.body {
			display: flex;
			flex-direction: column;
			flex: 1;

			.name {
				@include fonts-stack('Satoshi-Regular', sans);
				font-weight: 600;
				color: var(--color-text);
			}
			.desc {
				font-size: $x-font-size-sm;
				color: var(--color-text-muted);
			}
		}

		.tick {
			color: var(--color-primary);
		}
		.lock {
			color: var(--color-text-muted);
		}
	}

	.apps li {
		display: flex;
		align-items: center;
		gap: $x-space-sm;
		padding: $x-space-xs;
		border-radius: calc($x-space-xs / 2);
		background: var(--color-surface);

		> i:first-child {
			color: var(--color-text);
			width: 1.2em;
			text-align: center;
		}

		.name {
			flex: 1;
			@include fonts-stack('Satoshi-Regular', sans);
			color: var(--color-text);
		}

		.conn {
			border: 1px solid var(--color-bg);
			background: transparent;
			color: var(--color-text-muted);
			border-radius: calc($x-space-xs / 2);
			padding: calc($x-space-xs / 4) $x-space-xs;
			cursor: pointer;

			&.on {
				color: var(--color-primary);
				border-color: var(--color-primary);
			}
			&:hover {
				color: var(--color-primary);
			}
		}
	}
</style>
