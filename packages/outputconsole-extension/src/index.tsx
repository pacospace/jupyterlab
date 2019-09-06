/*-----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer
} from '@jupyterlab/application';

import { MainAreaWidget, WidgetTracker } from '@jupyterlab/apputils';

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';

import {
  IOutputLogRegistry,
  OutputLoggerView,
  OutputLogRegistry,
  ILogger,
  ILoggerChange,
  ILogRegistryChange
} from '@jupyterlab/outputconsole';

import { KernelMessage } from '@jupyterlab/services';

import { nbformat } from '@jupyterlab/coreutils';

import { VDomModel, VDomRenderer } from '@jupyterlab/apputils';

import React from 'react';

import {
  IStatusBar,
  GroupItem,
  IconItem,
  TextItem,
  interactiveItem
} from '@jupyterlab/statusbar';

/**
 * The Output Log extension.
 */
const outputLogPlugin: JupyterFrontEndPlugin<IOutputLogRegistry> = {
  activate: activateOutputLog,
  id: '@jupyterlab/outputconsole-extension:plugin',
  provides: IOutputLogRegistry,
  requires: [INotebookTracker, IStatusBar],
  optional: [ILayoutRestorer],
  autoStart: true
};

/*
 * A namespace for OutputStatusComponent.
 */
namespace OutputStatusComponent {
  /**
   * The props for the OutputStatusComponent.
   */
  export interface IProps {
    /**
     * A click handler for the item. By default
     * Output Console panel is launched.
     */
    handleClick: () => void;

    /**
     * Number of logs.
     */
    logCount: number;
  }
}

/**
 * A pure functional component for a Output Console status item.
 *
 * @param props - the props for the component.
 *
 * @returns a tsx component for rendering the Output Console logs.
 */
function OutputStatusComponent(
  props: OutputStatusComponent.IProps
): React.ReactElement<OutputStatusComponent.IProps> {
  return (
    <GroupItem
      spacing={0}
      onClick={props.handleClick}
      title={`${props.logCount} messages in Output Console`}
    >
      <IconItem source={'jp-StatusItem-output-console fa fa-list'} />
      <TextItem source={props.logCount} />
    </GroupItem>
  );
}

/**
 * A VDomRenderer widget for displaying the status of Output Console logs.
 */
export class OutputStatus extends VDomRenderer<OutputStatus.Model> {
  /**
   * Construct the output console status widget.
   */
  constructor(opts: OutputStatus.IOptions) {
    super();
    this._handleClick = opts.handleClick;
    this.model = new OutputStatus.Model(opts.outputLogRegistry);
    this.addClass(interactiveItem);
    this.addClass('outputconsole-status-item');

    let timer: number = null;

    this.model.stateChanged.connect(() => {
      if (!this.model.highlightingEnabled) {
        this._clearHighlight();
        return;
      }

      if (this.model.activeSourceChanged) {
        if (
          !this.model.activeSource ||
          this.model.isSourceOutputRead(this.model.activeSource)
        ) {
          this._clearHighlight();
        } else {
          this._showHighlighted();
        }

        this.model.activeSourceChanged = false;
        return;
      }

      // new message arrived
      const wasHilited = this.hasClass('hilite') || this.hasClass('hilited');
      if (wasHilited) {
        this._clearHighlight();
        // cancel previous request
        clearTimeout(timer);
        timer = setTimeout(() => {
          this._flashHighlight();
        }, 100);
      } else {
        this._flashHighlight();
      }
    });
  }

  /**
   * Render the output console status item.
   */
  render() {
    if (this.model === null) {
      return null;
    } else {
      return (
        <OutputStatusComponent
          handleClick={this._handleClick}
          logCount={this.model.logCount}
        />
      );
    }
  }

  private _flashHighlight() {
    this.addClass('hilite');
  }

  private _showHighlighted() {
    this.addClass('hilited');
  }

  private _clearHighlight() {
    this.removeClass('hilite');
    this.removeClass('hilited');
  }

  private _handleClick: () => void;
}

/**
 * A namespace for Output Console log status.
 */
export namespace OutputStatus {
  /**
   * A VDomModel for the OutputStatus item.
   */
  export class Model extends VDomModel {
    /**
     * Create a new OutputStatus model.
     */
    constructor(outputLogRegistry: IOutputLogRegistry) {
      super();

      this._outputLogRegistry = outputLogRegistry;

      this._outputLogRegistry.registryChanged.connect(
        (sender: IOutputLogRegistry, args: ILogRegistryChange) => {
          const loggers = this._outputLogRegistry.getLoggers();
          for (let logger of loggers) {
            if (this._loggersWatched.has(logger.source)) {
              continue;
            }

            logger.logChanged.connect(
              (sender: ILogger, args: ILoggerChange) => {
                if (sender.source === this._activeSource) {
                  this.stateChanged.emit(void 0);
                }

                // mark logger as dirty
                this._loggersWatched.set(sender.source, false);
              }
            );

            // mark logger as viewed
            this._loggersWatched.set(logger.source, true);
          }
        }
      );
    }

    get logCount(): number {
      if (this._activeSource) {
        const logger = this._outputLogRegistry.getLogger(this._activeSource);
        return logger.length;
      }

      return 0;
    }

    get activeSource(): string {
      return this._activeSource;
    }

    set activeSource(name: string) {
      this._activeSource = name;
      this.activeSourceChanged = true;

      // refresh rendering
      this.stateChanged.emit(void 0);
    }

    markSourceOutputRead(name: string) {
      this._loggersWatched.set(name, true);
    }

    isSourceOutputRead(name: string): boolean {
      return (
        !this._loggersWatched.has(name) ||
        this._loggersWatched.get(name) === true
      );
    }

    public highlightingEnabled: boolean = true;
    public activeSourceChanged: boolean = false;
    private _outputLogRegistry: IOutputLogRegistry;
    private _activeSource: string = null;
    private _loggersWatched: Map<string, boolean> = new Map();
  }

  /**
   * Options for creating a new OutputStatus item
   */
  export interface IOptions {
    /**
     * Output Console widget which provides
     * Output Console interface and access to log info
     */
    outputLogRegistry: IOutputLogRegistry;

    /**
     * A click handler for the item. By default
     * Output Console panel is launched.
     */
    handleClick: () => void;
  }
}

/**
 * Activate the Output Log extension.
 */
function activateOutputLog(
  app: JupyterFrontEnd,
  nbtracker: INotebookTracker,
  statusBar: IStatusBar,
  restorer: ILayoutRestorer | null
): IOutputLogRegistry {
  const logRegistry = new OutputLogRegistry();

  //let command = 'outputconsole:open';

  let tracker = new WidgetTracker<MainAreaWidget<OutputLoggerView>>({
    namespace: 'outputlogger'
  });
  // if (restorer) {
  //   void restorer.restore(tracker, {
  //     command,
  //     args: obj => ({ source: obj.content.logger.source }),
  //     name: () => 'outputLogger'
  //   });
  // }

  const status = new OutputStatus({
    outputLogRegistry: logRegistry,
    handleClick: () => {
      if (!loggerWidget) {
        createLoggerWidget();
      } else {
        loggerWidget.activate();
      }

      status.model.markSourceOutputRead(status.model.activeSource);
      status.model.highlightingEnabled = false;
      status.model.stateChanged.emit(void 0);
    }
  });

  let loggerWidget: MainAreaWidget<OutputLoggerView> = null;

  const createLoggerWidget = () => {
    let activeSource: string = nbtracker.currentWidget
      ? nbtracker.currentWidget.context.path
      : null;

    const loggerView = new OutputLoggerView(logRegistry);
    loggerWidget = new MainAreaWidget({ content: loggerView });
    loggerWidget.title.closable = true;
    loggerWidget.title.label = 'Output Console';
    loggerWidget.title.iconClass = 'fa fa-list lab-output-console-icon';

    app.shell.add(loggerWidget, 'main', {
      ref: '',
      mode: 'split-bottom'
    });
    void tracker.add(loggerWidget);
    loggerWidget.update();

    app.shell.activateById(loggerWidget.id);
    status.model.highlightingEnabled = false;

    if (activeSource) {
      loggerView.activeSource = activeSource;
    }

    loggerWidget.disposed.connect(() => {
      loggerWidget = null;
      status.model.highlightingEnabled = true;
    });
  };

  statusBar.registerStatusItem('@jupyterlab/outputconsole-extension:status', {
    item: status,
    align: 'left',
    isActive: () => true,
    activeStateChanged: status.model!.stateChanged
  });

  nbtracker.widgetAdded.connect(
    (sender: INotebookTracker, nb: NotebookPanel) => {
      //// TEST ////
      nb.context.session.iopubMessage.connect(
        (_, msg: KernelMessage.IIOPubMessage) => {
          if (
            KernelMessage.isDisplayDataMsg(msg) ||
            KernelMessage.isStreamMsg(msg) ||
            KernelMessage.isErrorMsg(msg)
          ) {
            const logger = logRegistry.getLogger(nb.context.path);
            logger.rendermime = nb.content.rendermime;
            logger.log((msg.content as unknown) as nbformat.IOutput);
          }
        }
      );
      //// TEST ////

      nb.activated.connect((nb: NotebookPanel, args: void) => {
        const sourceName = nb.context.path;
        if (loggerWidget) {
          loggerWidget.content.activeSource = sourceName;
        }
        status.model.activeSource = sourceName;
      });
    }
  );

  return logRegistry;
  // The notebook can call this command.
  // When is the output model disposed?
}

export default [outputLogPlugin];
