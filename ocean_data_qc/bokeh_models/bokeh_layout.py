# -*- coding: utf-8 -*-
#########################################################################
#    License, authors, contributors and copyright information at:       #
#    AUTHORS and LICENSE files at the root folder of this application   #
#########################################################################

from bokeh.util.logconfig import bokeh_logger as lg
from bokeh.layouts import column, row
from bokeh.models.layouts import Spacer
from bokeh.models.widgets.markups import Div

from ocean_data_qc.env import Environment
from ocean_data_qc.constants import *


class BokehLayout(Environment):
    env = Environment

    def __init__(self):
        lg.info('-- INIT BOKEH LAYOUT')
        self.env.bk_layout = self
        self.init_basic_layout()

    def init_basic_layout(self):
        self.env.tabs_widget_col = column(
            name='tabs_widget_col',
            children=[Spacer()],
            css_classes=['tabs_widget_col']
        )
        self.env.doc.add_root(self.env.tabs_widget_col)
        self.env.sidebar = column(
            name='sidebar_col',
            width=250,
            children=[Spacer()],
            css_classes=['sidebar_col'],
        )
        self.env.doc.add_root(self.env.sidebar)

        # TODO: Add plot styles from the theme.yaml file

        # curdoc().theme = Theme(json=yaml.load("""
        # attrs:
        #    DataTable:
        #        text_font_size: 8pt
        # """))

    def init_bokeh_layout(self):
        # ---------------------- DATATABLE ----------------------- #

        sample_control = row(
            children=[
                self.env.bk_table.previous_bt,
                self.env.bk_table.sample_div,
                self.env.bk_table.next_bt,
            ],
            css_classes=['sample_control'],
        )

        # ---------------------- CONTROLS ------------------------- #

        be = self.env.bk_events

        sidebar_col = self.env.doc.select_one({'name': 'sidebar_col'})
        sidebar_col.children.clear()
        sidebar_col.children = [
            self.env.flagger_select,
            self.env.flags_control_col,

            # NOTE: Switch object does not have labels, I need to add it manually
            row(
                children=[
                    be.cb_prof_invsbl_points,
                    Div(text='Fixed profiles')
                ],
                max_width=150,
            ),

            row(
                children=[
                    be.nearby_prof_cb,
                    Div(text='Show nearby station')
                ],
                max_width=150,
            ),

            row(
                children=[
                    be.previous_prof_bt,
                    be.nearby_prof_select,
                    be.next_prof_bt,
                ],
                css_classes=['prof_nav']
            ),

            Div(width=200, height=15, text='<u><b>Selected Samples</b></u>'),
            sample_control,
            self.env.bk_table.data_table,
            self.env.wmts_map,
        ]

        tabs_widget_col = self.env.doc.select_one({'name': 'tabs_widget_col'})
        tabs_widget_spacer = tabs_widget_col.select_one({'type': Spacer})

        if tabs_widget_spacer in tabs_widget_col.children:  # TODO: check why when reloading bokeh spacer is not in the doc
            tabs_widget_col.children.remove(tabs_widget_spacer)
        tabs_widget_col.children.insert(0, self.env.tabs_widget)
