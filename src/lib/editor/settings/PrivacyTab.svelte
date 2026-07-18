<script lang="ts">
	import {
		account,
		updateAccount,
		hasPassword,
		verifyPassword,
		changePassword
	} from '../account.js';

	// Click-to-show: sensitive values stay masked until the user explicitly reveals them.
	let revealed = $state(false);

	// Password-to-change: editing the sensitive fields is locked until the current password verifies.
	let unlocked = $state(false);
	let unlockInput = $state('');
	let unlockError = $state('');

	let draftEmail = $state($account.email);

	function tryUnlock() {
		if (verifyPassword(unlockInput)) {
			unlocked = true;
			unlockError = '';
			unlockInput = '';
			draftEmail = $account.email;
		} else {
			unlockError = 'Incorrect password.';
		}
	}

	function saveDetails() {
		const email = draftEmail.trim();
		if (email) updateAccount({ email });
		unlocked = false;
	}

	// Change-password form.
	let currentPw = $state('');
	let newPw = $state('');
	let confirmPw = $state('');
	let pwMessage = $state('');
	let pwOk = $state(false);

	function submitPassword() {
		pwMessage = '';
		pwOk = false;
		if (!newPw) {
			pwMessage = 'Enter a new password.';
			return;
		}
		if (newPw !== confirmPw) {
			pwMessage = 'New passwords don’t match.';
			return;
		}
		if (changePassword(currentPw, newPw)) {
			pwOk = true;
			pwMessage = 'Password updated.';
			currentPw = '';
			newPw = '';
			confirmPw = '';
		} else {
			pwMessage = 'Current password is incorrect.';
		}
	}

	const mask = (s: string) => '•'.repeat(Math.max(8, Math.min(s.length, 16)));
</script>

<div class="tab">
	<p class="note">
		<i class="fa-solid fa-circle-info"></i>
		This account lives only in this browser — there’s no server yet. These controls behave as they
		would against a real account.
	</p>

	<section>
		<h3>Sensitive information</h3>
		<div class="rows">
			<div class="row">
				<span class="k">Email</span>
				<span class="v">{revealed ? $account.email : mask($account.email)}</span>
			</div>
			<div class="row">
				<span class="k">Account ID</span>
				<span class="v">{revealed ? $account.accountId : mask($account.accountId)}</span>
			</div>
		</div>
		<div class="actions">
			<button class="ghost" onclick={() => (revealed = !revealed)}>
				<i class={revealed ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'}></i>
				{revealed ? 'Hide' : 'Reveal'}
			</button>
		</div>
	</section>

	<section>
		<h3>Change details</h3>
		{#if !unlocked}
			<p class="hint">
				Editing your details requires your password{hasPassword() ? '' : ' (none set yet — leave blank)'}.
			</p>
			<div class="inline">
				<input
					class="text"
					type="password"
					placeholder="Current password"
					bind:value={unlockInput}
					onkeydown={(e) => e.key === 'Enter' && tryUnlock()}
				/>
				<button class="primary" onclick={tryUnlock}>Unlock</button>
			</div>
			{#if unlockError}<p class="err">{unlockError}</p>{/if}
		{:else}
			<label class="field-label" for="privacy-email">Email</label>
			<div class="inline">
				<input id="privacy-email" class="text" type="email" bind:value={draftEmail} />
				<button class="primary" onclick={saveDetails}>Save</button>
				<button class="ghost" onclick={() => (unlocked = false)}>Cancel</button>
			</div>
		{/if}
	</section>

	<section>
		<h3>Change password</h3>
		<div class="rows">
			<input class="text" type="password" placeholder="Current password" bind:value={currentPw} />
			<input class="text" type="password" placeholder="New password" bind:value={newPw} />
			<input class="text" type="password" placeholder="Confirm new password" bind:value={confirmPw} />
		</div>
		<div class="actions">
			<button class="primary" onclick={submitPassword}>Update password</button>
			{#if pwMessage}<span class="msg" class:ok={pwOk}>{pwMessage}</span>{/if}
		</div>
	</section>

	<section>
		<h3>Data &amp; privacy</h3>
		<label class="check">
			<input
				type="checkbox"
				checked={$account.shareAnalytics}
				onchange={(e) => updateAccount({ shareAnalytics: e.currentTarget.checked })}
			/>
			Share anonymous usage analytics
		</label>
		<label class="check">
			<input
				type="checkbox"
				checked={$account.shareCrashReports}
				onchange={(e) => updateAccount({ shareCrashReports: e.currentTarget.checked })}
			/>
			Send crash reports
		</label>
	</section>
</div>

<style lang="scss">
	@use '_index' as *;

	.tab {
		@include layout-flex-column();
		gap: $x-space-md;
	}

	.note {
		display: flex;
		gap: $x-space-xs;
		align-items: baseline;
		color: var(--color-text-muted);
		font-size: $x-font-size-sm;
		background: var(--color-surface);
		padding: $x-space-xs;
		border-radius: calc($x-space-xs / 2);
		@include fonts-stack('Satoshi-Regular', sans);
	}

	section {
		@include layout-flex-column();
		gap: $x-space-xs;
	}

	h3,
	.field-label {
		font-size: $x-font-size-sm;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 1px;
		@include fonts-stack('Satoshi-Light', sans);
	}

	.hint {
		font-size: $x-font-size-sm;
		color: var(--color-text-muted);
	}

	.rows {
		@include layout-flex-column();
		gap: $x-space-xs;
	}

	.row {
		display: flex;
		justify-content: space-between;
		gap: $x-space-sm;
		padding: calc($x-space-xs / 2) $x-space-xs;
		background: var(--color-surface);
		border-radius: calc($x-space-xs / 2);

		.k {
			color: var(--color-text-muted);
		}
		.v {
			@include fonts-stack('Satoshi-Regular', sans);
			color: var(--color-text);
			font-variant-numeric: tabular-nums;
		}
	}

	.inline {
		display: flex;
		gap: $x-space-xs;
		align-items: center;
		flex-wrap: wrap;
	}

	.text {
		background: var(--color-surface);
		color: var(--color-text);
		border: 1px solid var(--color-bg);
		border-radius: calc($x-space-xs / 2);
		padding: calc($x-space-xs / 2) $x-space-xs;
		font-size: $x-font-size-md;
		@include fonts-stack('Satoshi-Regular', sans);
		flex: 1;
		min-width: calc($x-space-xxxl);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: $x-space-sm;
	}

	button {
		border-radius: calc($x-space-xs / 2);
		padding: calc($x-space-xs / 2) $x-space-sm;
		cursor: pointer;
		font-size: $x-font-size-md;
		@include fonts-stack('Satoshi-Regular', sans);
	}

	.primary {
		border: 1px solid var(--color-primary);
		background: var(--color-primary);
		color: var(--color-bg);

		&:hover {
			background: var(--color-primary-hover);
		}
	}

	.ghost {
		border: 1px solid var(--color-bg);
		background: transparent;
		color: var(--color-text-muted);

		&:hover {
			color: var(--color-primary);
		}
	}

	.check {
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		color: var(--color-text);
		@include fonts-stack('Satoshi-Regular', sans);
		font-size: $x-font-size-md;
	}

	.err {
		color: oklch(63.7% 0.2078 25.3);
		font-size: $x-font-size-sm;
	}

	.msg {
		font-size: $x-font-size-sm;
		color: var(--color-text-muted);
		&.ok {
			color: var(--color-primary);
		}
	}
</style>
