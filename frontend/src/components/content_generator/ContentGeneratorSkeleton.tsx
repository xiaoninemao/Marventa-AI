const SKELETON_CARDS = Array.from({ length: 5 });

export default function ContentGeneratorSkeleton() {
  return (
    <section className="amp-content-generation-skeleton" aria-busy="true" aria-label="Generating content">
      <header>
        <div>
          <span className="amp-content-skeleton-line w-36" />
          <span className="amp-content-skeleton-line mt-2 w-52" />
        </div>
        <span className="amp-content-skeleton-action" />
      </header>

      <div className="amp-content-skeleton-carousel">
        {SKELETON_CARDS.map((_, index) => (
          <div key={index} className="amp-content-skeleton-card">
            <span />
            <i />
            <i />
            <i />
          </div>
        ))}
      </div>

      <div className="amp-content-skeleton-dots" aria-hidden="true">
        {SKELETON_CARDS.map((_, index) => <i key={index} />)}
      </div>

      <div className="amp-content-detail-skeleton">
        <span />
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}
