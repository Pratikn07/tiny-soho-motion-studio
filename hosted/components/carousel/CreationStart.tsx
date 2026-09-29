import Icon from "./Icons";
import c from "./creation.module.css";

type Props = {
  onUpload: () => void;
  onExamples: () => void;
  busy: boolean;
};

export function CreationStart({ onUpload, onExamples, busy }: Props) {
  return (
    <main id="workspace" className={c.start}>
      <div className={c.startInner}>
        <p className={c.eyebrow}>CAROUSEL STUDIO · NEW CREATION</p>
        <h1 id="workspace-heading" tabIndex={-1}>
          Give your stills<br />
          <em>a little life.</em>
        </h1>
        <p className={c.intro}>
          Turn the moments you have already made into short, expressive videos.
          Your words, layout and original proportions stay where they belong.
        </p>
        <div className={c.uploadCard}>
          <span className={c.uploadIcon}>
            <Icon name="upload" size={23} />
          </span>
          <div>
            <h2>Paste or upload your images</h2>
            <p>
              PNG, JPG or WebP. Add a slide to begin, or drop images anywhere on
              this page.
            </p>
          </div>
          <button onClick={onUpload} disabled={busy}>
            Choose images <Icon name="arrow" size={15} />
          </button>
        </div>
        <div className={c.startSecondary}>
          <span>Need a starting point?</span>
          <button onClick={onExamples}>
            Explore examples <Icon name="arrow" size={14} />
          </button>
        </div>
      </div>
      <div className={c.startAside} aria-hidden="true">
        <span className={c.frameTop}>
          TINY SOHO <span>01 / 03</span>
        </span>
        <span className={c.frameArt}>
          <span className={c.sun} />
          <span className={c.hillOne} />
          <span className={c.hillTwo} />
        </span>
        <span className={c.frameCaption}>
          The smallest moments<br />make the loveliest stories.
        </span>
        <span className={c.frameBottom}>A LITTLE STORY, FRAME BY FRAME</span>
      </div>
    </main>
  );
}
