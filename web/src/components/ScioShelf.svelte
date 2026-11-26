<script lang="ts">
  import type { ScioSummary } from '../lib/api';
  import Icon from './Icon.svelte';

  let { summary }: { summary: Extract<ScioSummary, { enabled: true }> } = $props();

  const data = $derived(summary.data);
  const stale = $derived(summary.state === 'error');

  function since(iso: string): string {
    const date = new Date(iso);
    const time = new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit' }).format(date);
    if (Date.now() - date.getTime() < 20 * 60 * 60_000) return `Stand von ${time}.`;
    return `Stand vom ${new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'numeric' }).format(date)}, ${time}.`;
  }

  const countLabel = $derived.by(() => {
    if (!data) return '';
    if (data.dueToday > 0) return `${data.dueToday} fällig · ${data.reviewsToday}/${data.dailyGoal} heute`;
    return data.currentStreak > 0 ? `Serie ${data.currentStreak} ${data.currentStreak === 1 ? 'Tag' : 'Tage'}` : '';
  });
</script>

<section class="scio" aria-labelledby="h-scio" data-testid="scio-shelf">
  <h2 id="h-scio">
    <span class="badge" aria-hidden="true"><Icon name="cards" size={18} /></span>
    Lernen
    {#if countLabel}<span class="count">{countLabel}</span>{/if}
  </h2>

  {#if stale}
    <p class="notice error" role="status">
      {summary.updatedAt ? `${summary.error} ${since(summary.updatedAt)}` : summary.error}
    </p>
  {/if}

  {#if data}
    <div class:stale>
      {#if data.decks.length}
        <ul class="cards">
          {#each data.decks as deck, index (deck.id)}
            <li>
              <a class="deck" class:first={index === 0} href={deck.studyUrl} target="_blank" rel="noopener noreferrer" data-testid="scio-deck">
                <span class="due">{deck.due} <small>fällig</small></span>
                <span class="title">{deck.title}</span>
                {#if deck.subject}<span class="subject">{deck.subject}</span>{/if}
                <span class="split" aria-hidden="true">
                  {#if deck.dueReviews}<i style:flex-grow={deck.dueReviews}></i>{/if}
                  {#if deck.newAvailable}<u style:flex-grow={deck.newAvailable}></u>{/if}
                </span>
                <span class="visually-hidden">: {deck.dueReviews} zum Wiederholen, {deck.newAvailable} neu</span>
              </a>
            </li>
          {/each}
          <li>
            <a class="deck all" href={data.decksUrl} target="_blank" rel="noopener noreferrer">
              <span class="title">Alle Decks in Scio</span>
              <span class="subject">{data.deckCount === 1 ? '1 Deck' : `${data.deckCount} Decks`}</span>
              <span class="go"><Icon name="external" size={18} /></span>
            </a>
          </li>
        </ul>
        <p class="legend" aria-hidden="true">
          <span><i class="review"></i>Wiederholen</span>
          <span><i class="new"></i>Neu</span>
        </p>
      {:else}
        <a class="calm" href={data.decksUrl} target="_blank" rel="noopener noreferrer">
          <span class="tick" aria-hidden="true"><Icon name="check" size={20} /></span>
          <span>
            <span class="calm-title">Alles gelernt für heute.</span>
            {#if data.dailyGoal}<span class="subject">Tagesziel {data.reviewsToday} von {data.dailyGoal}</span>{/if}
          </span>
        </a>
      {/if}
    </div>
  {/if}
</section>

<style>
  .scio {
    margin-top: 1.75rem;
  }

  h2 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.6rem;
    margin-bottom: 0.7rem;
    font-size: 1.1875rem;
  }

  .badge {
    display: grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    background: var(--surface);
    color: var(--accent);
  }

  .count {
    color: var(--soft);
    font-size: var(--step-0);
    font-weight: 450;
  }

  .notice {
    margin: 0 0 0.75rem;
    font-size: var(--step--1);
  }

  /* An old state stays readable but recedes while Scio is unreachable. */
  .stale {
    opacity: 0.6;
  }

  /* Phones: a shelf of deck cards to swipe through, like the feed shelves. */
  .cards {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 46%;
    gap: 0.65rem;
    margin: 0 -1rem;
    padding: 0 1rem 0.25rem;
    list-style: none;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scroll-padding-inline: 1rem;
    scrollbar-width: none;
  }

  .cards li {
    display: grid;
    scroll-snap-align: start;
  }

  .deck {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-height: 9.5rem;
    padding: 0.85rem 0.95rem 0.8rem;
    border-radius: var(--radius-m);
    background: var(--surface);
    color: var(--ink);
    text-decoration: none;
  }

  .deck:hover .title {
    text-decoration: underline;
    text-decoration-color: var(--accent);
  }

  .deck.first {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .due {
    font-size: 2.875rem;
    font-weight: 780;
    font-stretch: 75%;
    line-height: 0.95;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }

  .due small {
    color: var(--soft);
    font-size: var(--step--1);
    font-weight: 600;
    font-stretch: 100%;
    letter-spacing: 0;
  }

  .title {
    margin-top: 0.45rem;
    font-weight: 650;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .subject {
    display: block;
    color: var(--soft);
    font-size: 0.8125rem;
  }

  .split {
    display: flex;
    height: 6px;
    margin-top: auto;
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-2);
  }

  /* The bar sits at the bottom so bars line up across cards with one- and two-line titles. */
  .deck .split {
    flex: none;
    margin-top: auto;
  }

  .deck .subject {
    margin-bottom: 0.65rem;
  }

  .split i,
  .legend .review {
    background: var(--accent);
  }

  .split u,
  .legend .new {
    background: var(--badge);
  }

  .deck.all {
    justify-content: space-between;
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .deck.all .title {
    margin-top: 0;
    color: var(--accent);
  }

  .go {
    align-self: flex-end;
    color: var(--accent);
  }

  .legend {
    display: flex;
    gap: 0.9rem;
    margin: 0.55rem 0.15rem 0;
    color: var(--soft);
    font-size: 0.8125rem;
  }

  .legend i {
    display: inline-block;
    width: 0.55rem;
    height: 0.55rem;
    margin-right: 0.35rem;
    border-radius: 50%;
  }

  .calm {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.95rem 1.1rem;
    border-radius: var(--radius-m);
    background: var(--surface);
    color: var(--ink);
    text-decoration: none;
  }

  .calm-title {
    display: block;
    font-weight: 650;
  }

  .tick {
    display: grid;
    flex: none;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    background: var(--accent-wash);
    color: var(--accent);
  }

  /* Desktop: the left column is narrow, so the decks wrap into two columns instead of scrolling. */
  @media (min-width: 1000px) {
    .cards {
      grid-auto-flow: row;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin: 0;
      padding: 0;
      overflow: visible;
    }
  }
</style>
