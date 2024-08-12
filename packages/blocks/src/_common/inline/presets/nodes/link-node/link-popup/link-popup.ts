import type { EditorIconButton } from '@blocksuite/affine-components/toolbar';
import type { BlockComponent } from '@blocksuite/block-std';
import type { InlineRange } from '@blocksuite/inline/types';

import {
  ConfirmIcon,
  CopyIcon,
  DeleteIcon,
  EditIcon,
  MoreVerticalIcon,
  OpenIcon,
  SmallArrowDownIcon,
  UnlinkIcon,
} from '@blocksuite/affine-components/icons';
import {
  renderActions,
  renderToolbarSeparator,
} from '@blocksuite/affine-components/toolbar';
import {
  getHostName,
  isValidUrl,
  normalizeUrl,
} from '@blocksuite/affine-shared/utils';
import { WithDisposable } from '@blocksuite/block-std';
import { assertExists } from '@blocksuite/global/utils';
import { computePosition, inline, offset, shift } from '@floating-ui/dom';
import { LitElement, html, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { choose } from 'lit/directives/choose.js';
import { join } from 'lit/directives/join.js';
import { repeat } from 'lit/directives/repeat.js';

import type { EmbedOptions } from '../../../../../../root-block/root-service.js';
import type { AffineInlineEditor } from '../../../affine-inline-specs.js';

import { toast } from '../../../../../components/toast.js';
import { BLOCK_ID_ATTR } from '../../../../../consts.js';
import { linkPopupStyle } from './styles.js';

@customElement('link-popup')
export class LinkPopup extends WithDisposable(LitElement) {
  private _bodyOverflowStyle = '';

  private _createTemplate = () => {
    this.updateComplete
      .then(() => {
        this.linkInput?.focus();

        this._updateConfirmBtn();
      })
      .catch(console.error);

    return html`
      <div class="affine-link-popover create">
        <input
          id="link-input"
          class="affine-link-popover-input"
          type="text"
          spellcheck="false"
          placeholder="Paste or type a link"
          @input=${this._updateConfirmBtn}
        />
        ${this._confirmBtnTemplate()}
      </div>
    `;
  };

  private _delete = () => {
    if (this.inlineEditor.isValidInlineRange(this.targetInlineRange)) {
      this.inlineEditor.deleteText(this.targetInlineRange);
    }
    this.abortController.abort();
  };

  private _edit = () => {
    this.type = 'edit';
  };

  private _editTemplate = () => {
    this.updateComplete
      .then(() => {
        assertExists(this.textInput);
        this.textInput.value = this.currentText;
        assertExists(this.linkInput);
        this.linkInput.value = this.currentLink;

        this.textInput.select();

        this._updateConfirmBtn();
      })
      .catch(console.error);

    return html`
      <div class="affine-link-edit-popover">
        <div class="affine-edit-area text">
          <input
            class="affine-edit-input"
            id="text-input"
            type="text"
            placeholder="Enter text"
            @input=${this._updateConfirmBtn}
          />
          <label class="affine-edit-label" for="text-input">Text</label>
        </div>
        <div class="affine-edit-area link">
          <input
            id="link-input"
            class="affine-edit-input"
            type="text"
            spellcheck="false"
            placeholder="Paste or type a link"
            @input=${this._updateConfirmBtn}
          />
          <label class="affine-edit-label" for="link-input">Link</label>
        </div>
        ${this._confirmBtnTemplate()}
      </div>
    `;
  };

  private _embedOptions: EmbedOptions | null = null;

  private _openLink = () => {
    let link = this.currentLink;
    if (!link.match(/^[a-zA-Z]+:\/\//)) {
      link = 'https://' + link;
    }
    window.open(link, '_blank');
    this.abortController.abort();
  };

  private _removeLink = () => {
    if (this.inlineEditor.isValidInlineRange(this.targetInlineRange)) {
      this.inlineEditor.formatText(this.targetInlineRange, {
        link: null,
      });
    }
    this.abortController.abort();
  };

  private _viewTemplate = () => {
    if (!this._rootService) {
      return nothing;
    }

    this._embedOptions = this._rootService.getEmbedBlockOptions(
      this.currentLink
    );

    const buttons = [
      html`
        <a
          class="affine-link-preview"
          href=${this.currentLink}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span>${getHostName(this.currentLink)}</span>
        </a>

        <editor-icon-button
          aria-label="Copy"
          data-testid="copy-link"
          .tooltip=${'Click to copy link'}
          @click=${this._copyUrl}
        >
          ${CopyIcon}
        </editor-icon-button>

        <editor-icon-button
          aria-label="Edit"
          data-testid="edit"
          .tooltip=${'Edit'}
          @click=${this._edit}
        >
          ${EditIcon}
        </editor-icon-button>
      `,

      this._viewMenuButton(),

      html`
        <editor-menu-button
          .contentPadding=${'8px'}
          .button=${html`
            <editor-icon-button aria-label="More" .tooltip=${'More'}>
              ${MoreVerticalIcon}
            </editor-icon-button>
          `}
        >
          <div data-size="large" data-orientation="vertical">
            ${this._moreActions()}
          </div>
        </editor-menu-button>
      `,
    ];

    return html`
      <editor-toolbar class="affine-link-popover view">
        ${join(
          buttons.filter(button => button !== nothing),
          renderToolbarSeparator
        )}
      </editor-toolbar>
    `;
  };

  static override styles = linkPopupStyle;

  private get _canConvertToEmbedView() {
    return this._embedOptions?.viewType === 'embed';
  }

  private _confirmBtnTemplate() {
    return html`
      <editor-icon-button
        class="affine-confirm-button"
        .iconSize=${'24px'}
        .disabled=${true}
        @click=${this._onConfirm}
      >
        ${ConfirmIcon}
      </editor-icon-button>
    `;
  }

  private _convertToCardView() {
    if (!this.inlineEditor.isValidInlineRange(this.targetInlineRange)) {
      return;
    }

    let targetFlavour = 'affine:bookmark';

    if (this._embedOptions && this._embedOptions.viewType === 'card') {
      targetFlavour = this._embedOptions.flavour;
    }

    const block = this.block;
    if (!block) return;
    const url = this.currentLink;
    const title = this.currentText;
    const props = {
      url,
      title: title === url ? '' : title,
    };
    const doc = block.doc;
    const parent = doc.getParent(block.model);
    assertExists(parent);
    const index = parent.children.indexOf(block.model);
    doc.addBlock(targetFlavour as never, props, parent, index + 1);

    const totalTextLength = this.inlineEditor.yTextLength;
    const inlineTextLength = this.targetInlineRange.length;
    if (totalTextLength === inlineTextLength) {
      doc.deleteBlock(block.model);
    } else {
      this.inlineEditor.formatText(this.targetInlineRange, { link: null });
    }

    this.abortController.abort();
  }

  private _convertToEmbedView() {
    if (!this._embedOptions || this._embedOptions.viewType !== 'embed') {
      return;
    }

    const { flavour } = this._embedOptions;
    const url = this.currentLink;

    const block = this.block;
    if (!block) return;
    const doc = block.doc;
    const parent = doc.getParent(block.model);
    assertExists(parent);
    const index = parent.children.indexOf(block.model);

    doc.addBlock(flavour as never, { url }, parent, index + 1);

    const totalTextLength = this.inlineEditor.yTextLength;
    const inlineTextLength = this.targetInlineRange.length;
    if (totalTextLength === inlineTextLength) {
      doc.deleteBlock(block.model);
    } else {
      this.inlineEditor.formatText(this.targetInlineRange, { link: null });
    }

    this.abortController.abort();
  }

  private _copyUrl() {
    navigator.clipboard.writeText(this.currentLink).catch(console.error);
    if (!this.host) return;
    toast(this.host, 'Copied link to clipboard');
    this.abortController.abort();
  }

  private get _isBookmarkAllowed() {
    const block = this.block;
    if (!block) return false;
    const schema = block.doc.schema;
    const parent = block.doc.getParent(block.model);
    if (!parent) return false;
    const bookmarkSchema = schema.flavourSchemaMap.get('affine:bookmark');
    if (!bookmarkSchema) return false;
    const parentSchema = schema.flavourSchemaMap.get(parent.flavour);
    if (!parentSchema) return false;

    try {
      schema.validateSchema(bookmarkSchema, parentSchema);
    } catch {
      return false;
    }

    return true;
  }

  private _moreActions() {
    return renderActions([
      [
        {
          name: 'Open',
          icon: OpenIcon,
          handler: this._openLink,
        },

        {
          name: 'Copy',
          icon: CopyIcon,
          handler: this._copyUrl,
        },

        {
          name: 'Remove link',
          icon: UnlinkIcon,
          handler: this._removeLink,
        },
      ],

      [
        {
          type: 'delete',
          name: 'Delete',
          icon: DeleteIcon,
          handler: this._delete,
        },
      ],
    ]);
  }

  private _onConfirm() {
    if (!this.inlineEditor.isValidInlineRange(this.targetInlineRange)) return;
    if (!this.linkInput) return;

    const linkInputValue = this.linkInput.value;
    if (!linkInputValue || !isValidUrl(linkInputValue)) return;

    const link = normalizeUrl(linkInputValue);

    if (this.type === 'create') {
      this.inlineEditor.formatText(this.targetInlineRange, {
        link: link,
        reference: null,
      });
      this.inlineEditor.setInlineRange(this.targetInlineRange);
      const textSelection = this.host?.selection.find('text');
      if (!textSelection) return;

      this.std?.range.syncTextSelectionToRange(textSelection);
    } else if (this.type === 'edit') {
      const text = this.textInput?.value ?? link;
      this.inlineEditor.insertText(this.targetInlineRange, text, {
        link: link,
        reference: null,
      });
      this.inlineEditor.setInlineRange({
        index: this.targetInlineRange.index,
        length: text.length,
      });
      const textSelection = this.host?.selection.find('text');
      if (!textSelection) return;

      this.std?.range.syncTextSelectionToRange(textSelection);
    }

    this.abortController.abort();
  }

  private _onKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      this._onConfirm();
    }
  }

  private get _rootService() {
    return this.std?.spec.getService('affine:page');
  }

  private _updateConfirmBtn() {
    assertExists(this.confirmButton);
    const link = this.linkInput?.value.trim();
    this.confirmButton.disabled = !(link && isValidUrl(link));
    this.confirmButton.requestUpdate();
  }

  private _viewMenuButton() {
    if (!this._isBookmarkAllowed) return nothing;

    const buttons = [];

    buttons.push({
      type: 'inline',
      name: 'Inline view',
    });

    buttons.push({
      type: 'card',
      name: 'Card view',
      handler: () => this._convertToCardView(),
    });

    if (this._canConvertToEmbedView) {
      buttons.push({
        type: 'embed',
        name: 'Embed view',
        handler: () => this._convertToEmbedView(),
      });
    }

    return html`
      <editor-menu-button
        .contentPadding=${'8px'}
        .button=${html`
          <editor-icon-button
            aria-label="Switch view"
            .justify=${'space-between'}
            .labelHeight=${'20px'}
            .iconContainerWidth=${'110px'}
          >
            <div class="label">Inline view</div>
            ${SmallArrowDownIcon}
          </editor-icon-button>
        `}
      >
        <div data-size="small" data-orientation="vertical">
          ${repeat(
            buttons,
            button => button.type,
            ({ type, name, handler }) => html`
              <editor-menu-action
                data-testid=${`link-to-${type}`}
                ?data-selected=${type === 'inline'}
                @click=${handler}
              >
                ${name}
              </editor-menu-action>
            `
          )}
        </div>
      </editor-menu-button>
    `;
  }

  override connectedCallback() {
    super.connectedCallback();

    if (this.targetInlineRange.length === 0) {
      return;
    }

    if (this.type === 'edit' || this.type === 'create') {
      // disable body scroll
      this._bodyOverflowStyle = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      this.disposables.add({
        dispose: () => {
          document.body.style.overflow = this._bodyOverflowStyle;
        },
      });
    }
  }

  protected override firstUpdated() {
    if (!this.linkInput) return;

    this._disposables.addFromEvent(this.linkInput, 'copy', e => {
      e.stopPropagation();
    });
    this._disposables.addFromEvent(this.linkInput, 'cut', e => {
      e.stopPropagation();
    });
    this._disposables.addFromEvent(this.linkInput, 'paste', e => {
      e.stopPropagation();
    });
  }

  override render() {
    return html`
      <div class="overlay-root">
        ${this.type === 'view'
          ? nothing
          : html`
              <div
                class="affine-link-popover-overlay-mask"
                @click=${() => {
                  this.abortController.abort();
                  this.host?.selection.clear();
                }}
              ></div>
            `}
        <div class="affine-link-popover-container" @keydown=${this._onKeydown}>
          ${choose(this.type, [
            ['create', this._createTemplate],
            ['edit', this._editTemplate],
            ['view', this._viewTemplate],
          ])}
        </div>
        <div class="mock-selection-container"></div>
      </div>
    `;
  }

  override updated() {
    assertExists(this.popupContainer);
    const range = this.inlineEditor.toDomRange(this.targetInlineRange);
    assertExists(range);

    if (this.type !== 'view') {
      const domRects = range.getClientRects();

      Object.values(domRects).forEach(domRect => {
        const mockSelection = document.createElement('div');
        mockSelection.classList.add('mock-selection');
        mockSelection.style.left = `${domRect.left}px`;
        mockSelection.style.top = `${domRect.top}px`;
        mockSelection.style.width = `${domRect.width}px`;
        mockSelection.style.height = `${domRect.height}px`;

        assertExists(this.mockSelectionContainer);
        this.mockSelectionContainer.append(mockSelection);
      });
    }

    const visualElement = {
      getBoundingClientRect: () => range.getBoundingClientRect(),
      getClientRects: () => range.getClientRects(),
    };
    computePosition(visualElement, this.popupContainer, {
      middleware: [
        offset(10),
        inline(),
        shift({
          padding: 6,
        }),
      ],
    })
      .then(({ x, y }) => {
        const popupContainer = this.popupContainer;
        if (!popupContainer) return;
        popupContainer.style.left = `${x}px`;
        popupContainer.style.top = `${y}px`;
      })
      .catch(console.error);
  }

  get block() {
    const block = this.inlineEditor.rootElement.closest<BlockComponent>(
      `[${BLOCK_ID_ATTR}]`
    );
    if (!block) return null;
    return block;
  }

  get currentLink() {
    const link = this.inlineEditor.getFormat(this.targetInlineRange).link;
    assertExists(link);
    return link;
  }

  get currentText() {
    return this.inlineEditor.yTextString.slice(
      this.targetInlineRange.index,
      this.targetInlineRange.index + this.targetInlineRange.length
    );
  }

  get host() {
    return this.block?.host;
  }

  get std() {
    return this.block?.std;
  }

  @property({ attribute: false })
  accessor abortController!: AbortController;

  @query('.affine-confirm-button')
  accessor confirmButton: EditorIconButton | null = null;

  @property({ attribute: false })
  accessor inlineEditor!: AffineInlineEditor;

  @query('#link-input')
  accessor linkInput: HTMLInputElement | null = null;

  @query('.mock-selection-container')
  accessor mockSelectionContainer!: HTMLDivElement;

  @query('.affine-link-popover-container')
  accessor popupContainer!: HTMLDivElement;

  @property({ attribute: false })
  accessor targetInlineRange!: InlineRange;

  @query('#text-input')
  accessor textInput: HTMLInputElement | null = null;

  @property()
  accessor type: 'create' | 'edit' | 'view' = 'create';
}

declare global {
  interface HTMLElementTagNameMap {
    'link-popup': LinkPopup;
  }
}
